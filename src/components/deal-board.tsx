"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  Info,
  LayoutGrid,
  List,
  LogOut,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AuthExpiredError, readBoard, expireBoard } from "@/lib/board-client";
import {
  loadPersonal,
  loadShowAll,
  loadViewMode,
  STORAGE_KEY,
  SHOW_ALL_KEY,
  VIEW_MODE_KEY,
  LEGACY_STORAGE_KEY,
  LEGACY_SHOW_ALL_KEY,
  type Personal,
  type ViewMode,
} from "@/lib/personal-storage";
import { filterDeals, type DealSort } from "@/lib/filter-deals";
import { normalizeBoardState } from "@/lib/board-view";
import { CATEGORIES, type BoardState, type Category, type DealDTO, type SourceStatus } from "@/lib/types";
import "./deal-board.css";

const emptyPersonal: Personal = { claimed: [], favorites: [] };
const staticMode = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
type Alert = { text: string; role: "status" | "alert"; testId: string };

function readError(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const value = (data as { error?: unknown }).error;
  return typeof value === "string" ? value : null;
}

function compactTime(label: string | null): string | null {
  if (!label) return null;
  return label.replace(/^\d{4}-/, "");
}

function shortSourceName(name: string): string {
  if (name === "LINUX DO福利羊毛") return "LINUX DO";
  if (name === "异次元软件世界") return "异次元";
  if (name === "V2EX推广") return "V2EX";
  return name;
}

function cleanSummary(summary: string, title: string): string | null {
  let trimmed = summary.trim();
  const cleanTitle = title.trim();
  if (cleanTitle && trimmed.startsWith(cleanTitle)) {
    trimmed = trimmed.slice(cleanTitle.length).replace(/^[，,。！？!?：:；;\s\-—·]+/, "").trim();
  }
  if (!trimmed) return null;
  if (/^(rt|如题|略|同标题|[.。…\-_~]+)$/i.test(trimmed)) return null;
  return trimmed;
}

function formatSourceQuality(source: SourceStatus): string {
  const quality = source.quality;
  if (!quality) return "";
  if (quality.warning) return `；质量提醒：${quality.warning}`;
  if (quality.consecutiveFailures && quality.consecutiveFailures >= 3) return `；连续失败 ${quality.consecutiveFailures} 轮`;
  if (quality.structureAnomaly) return "；解析结构异常";
  if (quality.countDrop) return "；解析条数骤降";
  return "";
}

function formatSourceOutcome(source: SourceStatus): string {
  const diagnostic = source.diagnostic === "missing_key" ? "；未配置可用 Jina key，匿名请求可能受限" : source.diagnostic === "rate_limited" ? "；来源限流，正在退避" : source.diagnostic === "circuit_open" ? "；熔断等待恢复" : source.diagnostic === "structure_anomaly" ? "；上游结构异常" : "";
  const quality = formatSourceQuality(source) + diagnostic;
  if (source.lastOk == null) return `尚未抓取${quality}`;
  if (source.lastOk) return `成功 ${source.lastFetched ?? 0} 条，新增 ${source.lastInserted ?? 0} 条${quality}`;
  return `失败（${source.lastError ?? "原因未记录"}），下一轮重试${quality}`;
}

function formatFailure(failure: { sourceName: string; error: string }): string {
  return `${failure.sourceName}（${failure.error}）`;
}

/**
 * 正式首页：服务端给初始快照，客户端挂载后展开，保留真实数据和本机状态。
 * authEnabled 为真时显示「退出」，并在会话过期后把人送回登录页。
 */
export function DealBoard({ initial, authEnabled = false }: { initial: BoardState; authEnabled?: boolean }) {
  const [board, setBoard] = useState<BoardState>(() => normalizeBoardState(initial) ?? initial);
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState<string | "all">("all");
  const [category, setCategory] = useState<Category | "all" | "favorites">("all");
  const [onlyNew, setOnlyNew] = useState(false);
  // 默认显示全部；尊重迁移后的偏好，搜索时不隐藏其他。
  const [showAllLeads, setShowAllLeads] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [displayLimit, setDisplayLimit] = useState(120);
  const [sort, setSort] = useState<DealSort>("newest");
  const [personal, setPersonal] = useState<Personal>(emptyPersonal);
  const [personalReady, setPersonalReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setBoard(normalizeBoardState(initial) ?? initial);
  }, [initial]);

  useEffect(() => {
    try {
      setShowAllLeads(loadShowAll(localStorage));
      setViewMode(loadViewMode(localStorage));
      setPersonal(loadPersonal(localStorage));
    } catch { setStorageError("浏览器存储不可用，本次操作仅保留在当前页面。"); }
    setPersonalReady(true);
    // 另一个标签页改动本机状态后，重新读取，避免旧内存覆盖新值。
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== null &&
        event.key !== STORAGE_KEY &&
        event.key !== SHOW_ALL_KEY &&
        event.key !== VIEW_MODE_KEY &&
        event.key !== LEGACY_STORAGE_KEY &&
        event.key !== LEGACY_SHOW_ALL_KEY
      ) {
        return;
      }
      if (event.key === null || event.key === SHOW_ALL_KEY || event.key === LEGACY_SHOW_ALL_KEY) {
        setShowAllLeads(loadShowAll(localStorage));
      }
      if (event.key === null || event.key === VIEW_MODE_KEY) {
        setViewMode(loadViewMode(localStorage));
      }
      if (event.key !== SHOW_ALL_KEY && event.key !== VIEW_MODE_KEY) {
        try { setPersonal((previous) => loadPersonal(localStorage, previous)); } catch { /* retain memory */ }
        setPersonalReady(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let stopped = false;
    let inFlight: AbortController | null = null;
    const tick = async () => {
      if (stopped || document.visibilityState === "hidden" || inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const next = await readBoard(controller.signal);
        if (!stopped) { setBoard(next); setPollError(false); }
      } catch (error) {
        if (stopped) return;
        // 会话过期后继续轮询只会一直 401；直接回登录页，收藏和已领在本机存储里不受影响。
        if (error instanceof AuthExpiredError) { stopped = true; window.location.assign("/login"); return; }
        setPollError(true);
      }
      finally { clearTimeout(timeout); inFlight = null; }
    };
    const onVisible = () => { if (document.visibilityState !== "hidden") void tick(); };
    void tick();
    const expireTimer = setInterval(() => { setBoard((previous) => expireBoard(previous, Date.now())); }, 30_000);
    const pollTimer = setInterval(() => { void tick(); }, staticMode ? 5 * 60_000 : 30_000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; inFlight?.abort(); clearInterval(expireTimer); clearInterval(pollTimer); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  function savePersonal(next: Personal) {
    setPersonal(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageError(null);
    } catch {
      // 隐私模式或配额满时，状态和存储必须显式说明不一致，而不是静默成功。
      setStorageError("收藏和已领没能写入这台浏览器（可能是隐私模式或存储已满），本次改动只在当前页面有效。");
    }
  }

  function saveShowAll(next: boolean) {
    setShowAllLeads(next);
    try {
      localStorage.setItem(SHOW_ALL_KEY, next ? "1" : "0");
    } catch {
      // 展示偏好写入失败只影响下次打开；当前页面仍按用户选择展示。
    }
  }

  function saveViewMode(next: ViewMode) {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // 视图偏好写入失败只影响下次打开。
    }
  }

  function toggle(list: "claimed" | "favorites", canonicalUrl: string) {
    const latest = personal;
    const current = new Set(latest[list]);
    if (current.has(canonicalUrl)) current.delete(canonicalUrl);
    else current.add(canonicalUrl);
    savePersonal({ ...latest, [list]: [...current] });
  }

  async function refresh() {
    setRefreshing(true);
    setMessage(null);
    if (staticMode) {
      try {
        const next = await readBoard(AbortSignal.timeout(15_000));
        setBoard({ ...next, refreshInProgress: false });
        setPollError(false);
        setMessage("已重新加载页面最新快照（源站抓取由 GitHub Actions 定时运行）");
      } catch {
        setMessage("网络异常，暂时无法加载快照");
      } finally {
        setRefreshing(false);
      }
      return;
    }
    try {
      const response = await fetch("/api/refresh", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(35_000) });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) {
        setMessage(readError(data) || "刷新没有完成");
        return;
      }
      const safe = normalizeBoardState(data);
      if (!safe) {
        setMessage("刷新结果格式异常，已保留当前列表。");
        return;
      }
      setBoard({ ...safe, refreshInProgress: false });
      setPollError(false);
    } catch {
      setMessage("网络异常，刷新没有完成");
    } finally {
      setRefreshing(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/session", { method: "DELETE", cache: "no-store" });
    } catch {
      // 断网时 cookie 清不掉；仍然回登录页，会话最迟 8 小时后自行过期。
    }
    window.location.assign("/login");
  }

  function resetFilters() {
    setSourceId("all");
    setCategory("all");
    setQuery("");
    setOnlyNew(false);
    saveShowAll(true);
    setSort("newest");
  }

  const claimedSet = new Set(personal.claimed);
  const favoriteSet = new Set(personal.favorites);
  // 「其他」只在默认的「全部」视图隐藏；显式选分类或收藏时仍按用户选择展示。
  const hideOther = !showAllLeads && category === "all" && !query.trim();
  const filters = { query, sourceId, category, onlyNew, sort, includeOther: !hideOther };
  const matching =
    category === "favorites" && !personalReady
      ? []
      : filterDeals(board.deals, { ...filters, includeOther: true }, personal);
  const visible =
    category === "favorites" && !personalReady
      ? []
      : filterDeals(board.deals, filters, personal);
  const hiddenOtherCount = hideOther ? matching.filter((item) => item.category === "其他").length : 0;
  const waitingForFirst = !board.lastUpdatedAt && (board.refreshInProgress || refreshing);
  const busy = refreshing || board.refreshInProgress;
  const activeFilters = [sourceId !== "all", category !== "all", query.trim().length > 0, onlyNew, sort !== "newest"].filter(Boolean).length;

  const statusItems = [
    { label: "更新", value: board.lastUpdatedLabel ? compactTime(board.lastUpdatedLabel)! : "尚未更新", title: board.lastUpdatedLabel ? `${board.lastUpdatedLabel} 北京时间` : undefined, testId: "status-update" },
    { label: "来源", value: `${board.sourceHealth.ok}/${board.sourceHealth.total}`, testId: "status-sources" },
    { label: "已收录", value: String(board.activeCount), testId: "status-active" },
    { label: "本轮新增", value: String(board.newCount), testId: "status-new" },
    { label: "下次更新", value: board.nextRefreshLabel ? compactTime(board.nextRefreshLabel)! : "尚未排期", title: board.nextRefreshLabel ? `${board.nextRefreshLabel} 北京时间` : undefined, testId: "status-next" },
  ];

  const alerts: Alert[] = [];
  if (board.freshness?.stale) alerts.push({ text: "数据已过时，请检查抓取状态。", role: "status", testId: "stale" });
  if (pollError) alerts.push({ text: "数据暂时不可用，显示的是上次成功读取的内容；恢复后会自动更新。", role: "status", testId: "poll-error" });
  if (storageError) alerts.push({ text: storageError, role: "alert", testId: "storage-error" });
  if (message) alerts.push({ text: message, role: "alert", testId: "refresh-message" });
  if (board.anomalies?.length) alerts.push({ text: `数据提示：${board.anomalies.join("；")}`, role: "status", testId: "anomalies" });
  if (board.failures.length) alerts.push({ text: `未能抓取，下一轮重试：${board.failures.map(formatFailure).join("、")}`, role: "status", testId: "failures" });

  const categoryCounts = new Map<string, number>();
  for (const deal of board.deals) {
    categoryCounts.set(deal.category, (categoryCounts.get(deal.category) ?? 0) + 1);
  }

  const emptyMessage =
    category === "favorites" && !personalReady
      ? "正在读取这台浏览器里的收藏。"
      : pollError && board.deals.length === 0
        ? "数据暂时不可用，还无法读取条目；恢复后会自动更新，这里不会填入示例优惠。"
        : board.deals.length === 0
          ? board.lastUpdatedAt
            ? "这一轮没有已收录的条目。失败的来源会在下一轮重试，这里不会填入示例优惠。"
            : "服务端还没有完成抓取。空列表是真实状态，不会填入示例优惠。"
          : hiddenOtherCount > 0 && visible.length === 0
            ? "当前条件下只剩已隐藏的「其他」线索；打开「查看全部线索」即可查看。"
            : "没有符合当前筛选的条目。";

  if (!mounted) return <div className="perk-board" data-testid="board-root"><div className="board-loading" role="status" data-testid="loading">正在打开…</div></div>;

  return (
    <div className="perk-board" data-testid="board-root">
      <div className="demo-shell">
        <header className="demo-header" data-testid="header">
          <div className="demo-brand-wrap">
            <Link className="demo-brand" href="/" data-testid="brand"><Radar aria-hidden="true" />PerkRadar</Link>
            <span className="board-lead-note" data-testid="lead-note"><ShieldCheck aria-hidden="true" />公开订阅源线索聚合，未核实活动有效性或领取条件，请以原文为准。</span>
          </div>
          <div className="demo-header-actions">
            {board.lastUpdatedLabel ? (
              <span className="header-sync-meta" title={`${board.lastUpdatedLabel} 北京时间`}>
                更新于 {compactTime(board.lastUpdatedLabel)}
              </span>
            ) : null}
            <Button className="board-refresh" data-testid="refresh" onClick={refresh} disabled={busy} aria-busy={busy}>
              <RefreshCw aria-hidden="true" />{busy ? "刷新中" : staticMode ? "同步快照" : "立即刷新"}
            </Button>
            {authEnabled ? (
              <Button variant="ghost" data-testid="sign-out" onClick={signOut}><LogOut aria-hidden="true" />退出</Button>
            ) : null}
          </div>
        </header>

        {alerts.length > 0 ? (
          <div className="board-alert-strip" data-testid="alerts" aria-live="polite">
            {alerts.map((alert) => <p key={alert.testId} className="board-alert" role={alert.role} data-testid={alert.testId}>{alert.text}</p>)}
          </div>
        ) : null}

        <div className="demo-layout">
          <aside className="demo-sidebar" aria-label="搜索与筛选" data-testid="sidebar">
            <button className="demo-filter-toggle" type="button" aria-expanded={mobileFiltersOpen} aria-controls="demo-filter-body" data-testid="filter-toggle" onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}>
              <SlidersHorizontal aria-hidden="true" />搜索与筛选{activeFilters ? <span className="demo-filter-count">{activeFilters}</span> : null}<ChevronDown aria-hidden="true" />
            </button>
            <div id="demo-filter-body" className="demo-filter-body" data-open={mobileFiltersOpen ? "true" : "false"}>
              <div className="demo-sidebar-head"><h2>筛选</h2><Button className="demo-reset" variant="ghost" size="sm" data-testid="reset" onClick={resetFilters}>重置</Button></div>

              <form className="demo-search" role="search" onSubmit={(event) => event.preventDefault()}>
                <label className="sr-only" htmlFor="deal-search">搜索标题</label>
                <Input id="deal-search" type="search" data-testid="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词…" />
                <Button type="submit" size="icon" aria-label="搜索线索"><Search aria-hidden="true" /></Button>
              </form>

              <div className="sidebar-sort-row">
                <label className="sr-only" htmlFor="deal-sort">排序方式</label>
                <select id="deal-sort" className="board-sort" data-testid="sort" aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value as DealSort)}>
                  <option value="newest">排序：最新发布</option>
                  <option value="expiring">排序：即将到期</option>
                </select>
              </div>

              <section className="demo-filter-group" aria-label="来源筛选">
                <h3>来源</h3>
                <div className="demo-filter-row">
                  <Pill pressed={sourceId === "all"} testId="source-chip" onClick={() => setSourceId("all")}>全部<span>{board.activeCount}</span></Pill>
                  {board.sources.map((source) => (
                    <Pill key={source.id} pressed={sourceId === source.id} testId="source-chip" onClick={() => setSourceId(source.id)}>{shortSourceName(source.name)}<span>{source.activeCount}</span></Pill>
                  ))}
                </div>
              </section>

              <section className="demo-filter-group" aria-label="分类筛选">
                <h3>分类</h3>
                <div className="demo-filter-row">
                  <Pill pressed={category === "all"} testId="category-chip" onClick={() => setCategory("all")}>全部</Pill>
                  {CATEGORIES.map((item) => (
                    <Pill key={item} pressed={category === item} testId="category-chip" onClick={() => setCategory(item)}>{item}<span>{categoryCounts.get(item) ?? 0}</span></Pill>
                  ))}
                  <Pill pressed={category === "favorites"} testId="category-chip" onClick={() => setCategory(category === "favorites" ? "all" : "favorites")}><Bookmark aria-hidden="true" />收藏<span>{personalReady ? favoriteSet.size : 0}</span></Pill>
                </div>
              </section>

              <section className="board-status" aria-label="运行状态">
                <h3>状态</h3>
                <dl className="board-status-list" data-testid="stats">
                  {statusItems.map((item) => <StatusItem key={item.label} label={item.label} value={item.value} title={item.title} testId={item.testId} />)}
                </dl>
              </section>

              <details className="board-source-results" data-testid="source-results">
                <summary><Info aria-hidden="true" />各来源本轮结果</summary>
                <ul>
                  {board.sources.map((source) => <li key={source.id}>{source.name}：{formatSourceOutcome(source)}</li>)}
                </ul>
              </details>
            </div>
          </aside>

          <main className="demo-content" data-testid="content">
            <div className="demo-results-heading" data-testid="results-heading">
              <h1>信息列表</h1>
              <span className="board-results-count" role="status" data-testid="visible-count">{visible.length} 条</span>
              {hiddenOtherCount > 0 ? (
                <span className="board-hidden-note" role="status" data-testid="hidden-note">（已隐藏 {hiddenOtherCount} 条其他）</span>
              ) : null}
              <div className="demo-results-actions">
                <div className="view-mode-switch" role="group" aria-label="版式切换" data-testid="view-switch">
                  <button
                    type="button"
                    className="view-mode-btn"
                    data-testid="view-grid"
                    aria-pressed={viewMode === "grid"}
                    onClick={() => saveViewMode("grid")}
                  >
                    <LayoutGrid aria-hidden="true" />卡片
                  </button>
                  <button
                    type="button"
                    className="view-mode-btn"
                    data-testid="view-list"
                    aria-pressed={viewMode === "list"}
                    onClick={() => saveViewMode("list")}
                  >
                    <List aria-hidden="true" />列表
                  </button>
                </div>
                <label className="demo-new-toggle demo-results-toggle">
                  <input type="checkbox" data-testid="show-all" checked={showAllLeads} onChange={(event) => saveShowAll(event.target.checked)} />
                  <span className="demo-switch" aria-hidden="true" />查看全部线索
                </label>
                <label className="demo-new-toggle demo-results-toggle">
                  <input type="checkbox" data-testid="only-new" checked={onlyNew} onChange={(event) => setOnlyNew(event.target.checked)} />
                  <span className="demo-switch" aria-hidden="true" />只看新增
                </label>
              </div>
            </div>

            {waitingForFirst ? <p className="board-empty-note" role="status">正在进行首次抓取…</p> : null}

            {visible.length > 0 ? (
              <section className="demo-cards" data-view={viewMode} aria-label="优惠列表" data-testid="cards">
                {visible.slice(0, displayLimit).map((deal) => (
                  <DealCard
                    key={deal.canonicalUrl}
                    deal={deal}
                    viewMode={viewMode}
                    claimed={personalReady && claimedSet.has(deal.canonicalUrl)}
                    favorite={personalReady && favoriteSet.has(deal.canonicalUrl)}
                    onClaim={() => toggle("claimed", deal.canonicalUrl)}
                    onFavorite={() => toggle("favorites", deal.canonicalUrl)}
                  />
                ))}
              </section>
            ) : null}

            {visible.length === 0 ? (
              <div className="demo-empty" data-testid="empty-state" role="status">
                <Search aria-hidden="true" />
                <h2>没有可显示的条目</h2>
                <p className="board-empty-note">{emptyMessage}</p>
                <Button variant="outline" onClick={resetFilters}>清除筛选</Button>
              </div>
            ) : null}

            <footer className="demo-footer" data-testid="footer">
              <span role="status" data-testid="display-range">显示 {Math.min(displayLimit, visible.length)} / {visible.length} 条（共收录近 7 天 {board.deals.length} 条）</span>
              {visible.length > displayLimit ? (
                <Button variant="outline" size="sm" onClick={() => setDisplayLimit((value) => value + 120)}>再加载 120 条</Button>
              ) : null}
              <span className="board-footer-note">提示：收藏与已领仅保存在当前浏览器本地；未注明截止时间的条目保留 7 天，有截止时间的到点下架。</span>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

function StatusItem({ label, value, title, testId }: { label: string; value: string; title?: string; testId: string }) {
  return <div className="board-status-item" data-testid={testId}><dt>{label}</dt><dd title={title}>{value}</dd></div>;
}

function Pill({ pressed, onClick, children, testId }: { pressed: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <Button className="demo-pill" variant={pressed ? "default" : "outline"} aria-pressed={pressed} data-testid={testId} onClick={onClick}>
      {children}
    </Button>
  );
}

function DealCard({
  deal,
  viewMode,
  claimed,
  favorite,
  onClaim,
  onFavorite,
}: {
  deal: DealDTO;
  viewMode: ViewMode;
  claimed: boolean;
  favorite: boolean;
  onClaim: () => void;
  onFavorite: () => void;
}) {
  const summaryText = cleanSummary(deal.summary, deal.title);
  const pubShort = compactTime(deal.publishedLabel);
  const expShort = compactTime(deal.expiresLabel);
  const sourceShort = shortSourceName(deal.sourceName);

  if (viewMode === "list") {
    return (
      <article
        className="deal-row-compact"
        data-claimed={claimed ? "true" : "false"}
        data-new={deal.isNew ? "true" : "false"}
        data-testid="deal-card"
        aria-label={deal.title}
      >
        <div className="deal-row-badges">
          {deal.isNew ? <span className="deal-mini-new" data-testid="deal-new">新</span> : null}
          <Badge variant="secondary" className="deal-mini-badge" data-testid="deal-category">{deal.category}</Badge>
        </div>

        <div className="deal-row-main">
          <h2 className="deal-row-title" data-testid="deal-title">
            <a href={deal.url} target="_blank" rel="noopener noreferrer" data-testid="open-original" title={deal.title}>
              {deal.title}
              <ArrowUpRight className="deal-ext-icon" aria-hidden="true" />
            </a>
          </h2>
          {expShort ? (
            <Badge variant={deal.expiresSoon ? "destructive" : "outline"} className="deal-mini-badge deal-expiry-badge" data-testid="deal-expiry" title={`到期 ${deal.expiresLabel}`}>
              {deal.expiresSoon ? "临期" : "至"} {expShort}
            </Badge>
          ) : null}
          {summaryText ? (
            <span className="deal-row-summary" data-testid="deal-summary" title={summaryText}>{summaryText}</span>
          ) : null}
        </div>

        <div className="deal-row-right">
          <span className="deal-row-source" data-testid="deal-source" title={deal.sourceName}>{sourceShort}</span>
          {pubShort ? <span className="deal-row-time" title={`发布 ${deal.publishedLabel}`}>{pubShort}</span> : null}
          <div className="deal-mini-actions">
            <button
              type="button"
              className="deal-icon-btn"
              data-testid="favorite"
              aria-label={`${favorite ? "取消收藏" : "收藏"}：${deal.title}`}
              aria-pressed={favorite}
              title={favorite ? "取消收藏" : "收藏"}
              onClick={onFavorite}
            >
              <Bookmark aria-hidden="true" />
            </button>
            <button
              type="button"
              className="deal-claim-btn"
              data-testid="claim"
              aria-pressed={claimed}
              title={claimed ? "撤销已领" : "标记已领"}
              onClick={onClaim}
            >
              <Check aria-hidden="true" />
              <span>{claimed ? "已领" : "标记"}</span>
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="deal-card-compact"
      data-claimed={claimed ? "true" : "false"}
      data-new={deal.isNew ? "true" : "false"}
      data-testid="deal-card"
      aria-label={deal.title}
    >
      <div className="deal-card-top">
        <div className="deal-card-meta">
          {deal.isNew ? <span className="deal-mini-new" data-testid="deal-new">新增</span> : null}
          <Badge variant="secondary" className="deal-mini-badge" data-testid="deal-category">{deal.category}</Badge>
          <span className="deal-card-source" data-testid="deal-source" title={deal.sourceName}>{sourceShort}</span>
          {pubShort ? <span className="deal-card-time" title={`发布 ${deal.publishedLabel}`}>{pubShort}</span> : null}
        </div>
        <div className="deal-mini-actions">
          <button
            type="button"
            className="deal-icon-btn"
            data-testid="favorite"
            aria-label={`${favorite ? "取消收藏" : "收藏"}：${deal.title}`}
            aria-pressed={favorite}
            title={favorite ? "取消收藏" : "收藏"}
            onClick={onFavorite}
          >
            <Bookmark aria-hidden="true" />
          </button>
          <button
            type="button"
            className="deal-claim-btn"
            data-testid="claim"
            aria-pressed={claimed}
            title={claimed ? "撤销已领" : "标记已领"}
            onClick={onClaim}
          >
            <Check aria-hidden="true" />
            <span>{claimed ? "已领" : "标记"}</span>
          </button>
        </div>
      </div>

      <h2 className="deal-card-title" data-testid="deal-title">
        <a href={deal.url} target="_blank" rel="noopener noreferrer" data-testid="open-original" title={deal.title}>
          {deal.title}
          <ArrowUpRight className="deal-ext-icon" aria-hidden="true" />
        </a>
      </h2>

      {summaryText ? (
        <p className="deal-card-desc" data-testid="deal-summary" title={summaryText}>{summaryText}</p>
      ) : null}

      {expShort ? (
        <div className="deal-card-foot">
          <Badge variant={deal.expiresSoon ? "destructive" : "outline"} className="deal-mini-badge" data-testid="deal-expiry" title={`到期 ${deal.expiresLabel}`}>
            {deal.expiresSoon ? "临期" : "截止"} {expShort}
          </Badge>
        </div>
      ) : null}
    </article>
  );
}
