<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { parkDate, addCalendarDays, PARK_TIME_ZONE } from '../../../shared/visitSchedule.js';
  import { createMetricsRefresh, metricReportFilters, metricsSelection } from '../lib/dashboardInteractions.js';
  import { reportPeriod } from '../../../shared/reportPeriods.js';

  // Requests retain App's session verification and administrative access handling.
  export let api;
  export let selection = { granularity: 'month', anchor: parkDate(), followCurrent: true };
  const dispatch = createEventDispatcher();
  const periods = [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']];
  const cards = [['day', 'Hoy'], ['week', 'Esta semana'], ['month', 'Este mes'], ['year', 'Este año']];
  const stateLabels = { pending: 'Pendientes', approved: 'Aprobadas', rejected: 'Rechazadas', revoked: 'Revocadas', other: 'Otros estados históricos' };
  const colors = { approved: '#164c3b', pending: '#ce991f', rejected: '#bd4141', revoked: '#77716d', other: '#58758b' };
  const number = new Intl.NumberFormat('es-MX');
  const percent = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
  let data = null, busy = true, error = '', refresh;
  $: granularity = selection.granularity;
  $: anchor = selection.anchor;
  $: displayedGranularity = data?.period.granularity || granularity;
  function dayLabel(day) {
    return new Date(`${day}T12:00:00Z`).toLocaleDateString('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function rangeLabel(period) { return period.from === period.to ? dayLabel(period.from) : `${dayLabel(period.from)} – ${dayLabel(period.to)}`; }
  function bucketLabel(bucket, full = false) {
    const options = displayedGranularity === 'day'
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(full ? { timeZoneName: 'shortOffset' } : {}) }
      : displayedGranularity === 'year' ? { month: 'short', ...(full ? { year: 'numeric' } : {}) } : { day: 'numeric', month: 'short' };
    return new Date(bucket.start).toLocaleString('es-MX', { timeZone: PARK_TIME_ZONE, ...options });
  }
  function load(changed = false) { refresh?.refresh(changed); }
  function selectPeriod(value) { selection = { ...selection, granularity: value }; load(true); }
  function selectDate(value) { selection = { ...selection, anchor: value, followCurrent: false }; load(true); }
  function move(direction) {
    try {
      const period = reportPeriod(granularity, anchor);
      selection = { ...selection, anchor: direction < 0 ? addCalendarDays(period.from, -1) : addCalendarDays(period.to, 1), followCurrent: false };
      load(true);
    } catch (e) { error = e.message; }
  }
  function current() { selection = { ...selection, anchor: parkDate(), followCurrent: true }; load(true); }
  function intervalHref(row) {
    return `/admin?${new URLSearchParams({ tab: 'db-report', expectedTotal: String(row.count), dashboardPeriod: selection.granularity, dashboardAnchor: selection.anchor, dashboardCurrent: String(selection.followCurrent), ...metricReportFilters(data, 'interval', row) })}`;
  }
  function openMetric(kind, row, total) {
    dispatch('openReport', { filters: metricReportFilters(data, kind, row), expectedTotal: total });
  }
  onMount(() => {
    refresh = createMetricsRefresh({
      request: signal => {
        selection = metricsSelection(selection);
        reportPeriod(selection.granularity, selection.anchor);
        return api(`/admin/reports/metrics?${new URLSearchParams({ granularity: selection.granularity, anchor: selection.anchor })}`, "GET", undefined, { signal });
      },
      onSuccess: result => { data = result; error = ''; },
      onError: e => { error = e.message || 'No se pudieron actualizar las métricas.'; },
      onBusy: value => { busy = value; }
    });
    const visibility = () => refresh.setVisible(document.visibilityState === 'visible');
    const focus = () => { if (document.visibilityState === 'visible') refresh.refresh(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    visibility();
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', focus); refresh.dispose(); };
  });
  onDestroy(() => refresh?.dispose());

  $: series = data?.series || [];
  $: ceiling = Math.max(4, Math.ceil(Math.max(0, ...series.map(b => b.count)) / 4) * 4);
  $: points = series.map((bucket, i) => ({ ...bucket, x: 52 + (series.length > 1 ? i / (series.length - 1) : 0.5) * 660, y: 208 - bucket.count / ceiling * 168 }));
  $: line = points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  $: area = points.length ? `${line} L ${points.at(-1).x} 208 L ${points[0].x} 208 Z` : '';
  $: states = (data?.states || []).filter(s => s.status !== 'other' || s.count > 0);
  $: segments = states.reduce((result, state) => {
    result.push({ ...state, offset: result.reduce((sum, item) => sum + item.percentage, 0) }); return result;
  }, []);
  $: attractions = [...(data?.attractions || [])].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  $: provenance = [...(data?.provenance || [])].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
</script>

<section class="dashboard" aria-label="Dashboard de registros" aria-busy={busy}>
  <div class="heading">
    <div><h2>Dashboard</h2><p>Cartas responsivas y registros de visitantes</p></div>
    <div class="controls">
      <div class="periods" role="group" aria-label="Periodo de análisis">
        {#each periods as [value, label]}<button type="button" aria-pressed={granularity === value} class:selected={granularity === value} on:click={() => selectPeriod(value)}>{label}</button>{/each}
      </div>
      <label>Fecha de referencia<input type="date" value={anchor} on:change={event => selectDate(event.currentTarget.value)} /></label>
    </div>
  </div>
  <div class="navigation" role="group" aria-label="Navegar entre periodos">
    <button type="button" on:click={() => move(-1)} aria-label="Periodo anterior">← Anterior</button>
    <button type="button" on:click={current}>Periodo actual</button>
    <button type="button" on:click={() => move(1)} aria-label="Periodo siguiente">Siguiente →</button>
    <button type="button" disabled={busy} on:click={() => load()}>Actualizar</button>
    <span>Zona horaria: Chihuahua</span>
  </div>
  {#if busy}<p class="notice" role="status">{data ? 'Actualizando métricas…' : 'Cargando métricas…'}</p>{/if}
  {#if error}<div class="notice error" role="alert"><p>{error}</p>{#if data}<p>Se conservan los datos de la última consulta correcta para el periodo indicado.</p>{/if}<button type="button" disabled={busy} on:click={() => load()}>Reintentar</button></div>{/if}
  {#if data}
    <div class="cards">
      {#each cards as [unit, label]}
        <button type="button" class="stat" on:click={() => openMetric('current', data.current[unit], data.current[unit].total)}><div class="stat-title"><h3>{label}</h3><span class="stat-icon" aria-hidden="true">▥</span></div><strong>{number.format(data.current[unit].total)}</strong><p>Cartas del periodo actual</p><small>{rangeLabel(data.current[unit])}</small></button>
      {/each}
    </div>
    <button type="button" class="historical" on:click={() => openMetric('historical', null, data.historicalTotal)}><span>Total histórico de cartas</span><strong>{number.format(data.historicalTotal)}</strong><small>Excluye registros eliminados</small></button>
    <p class="selection">Periodo seleccionado: <strong>{rangeLabel(data.period)}</strong></p>
    <div class="charts">
      <article class="panel trend">
        <div class="panel-heading"><div><h3>Registros</h3><p>Tendencia de cartas generadas {displayedGranularity === 'day' ? 'por hora' : displayedGranularity === 'year' ? 'por mes' : 'por día'}</p></div><span class="badge">{number.format(data.total)} cartas</span></div>
        {#if data.total === 0}<p class="empty" role="status">No hay registros en este periodo.</p>{/if}
        <!-- El contenedor desplazable necesita foco para permitir scroll con teclado. -->
        <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
        <div class="plot" role="region" aria-label="Gráfica de tendencia desplazable" tabindex="0">
        <svg class="trend-chart" viewBox="0 0 760 260" role="group" aria-label={`Tendencia de registros: ${number.format(data.total)} cartas. Datos completos en la tabla inferior.`}>
          {#each [0, 0.25, 0.5, 0.75, 1] as step}
            <line x1="52" x2="712" y1={208 - step * 168} y2={208 - step * 168} stroke="#e4e8e4" stroke-dasharray="3 4" />
            <text x="42" y={213 - step * 168} text-anchor="end">{number.format(Math.round(ceiling * step))}</text>
          {/each}
          <path d={area} fill="#164c3b" fill-opacity="0.09" />
          <path d={line} fill="none" stroke="#164c3b" stroke-width="3" />
          {#each points as point, i}
            <a href={intervalHref(point)} on:click|preventDefault={() => openMetric('interval', point, point.count)} aria-label={`${bucketLabel(point, true)}: ${number.format(point.count)} cartas; ver registros`}><circle cx={point.x} cy={point.y} r="12" fill="transparent" /><circle class="point" cx={point.x} cy={point.y} r="4" fill="white" stroke="#164c3b" stroke-width="2"><title>{bucketLabel(point, true)}: {number.format(point.count)} cartas</title></circle></a>
            {#if i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0}<text x={point.x} y="239" text-anchor="middle">{bucketLabel(point)}</text>{/if}
          {/each}
        </svg>
        </div>
        <details><summary>Consultar datos de la tendencia</summary><div class="table-scroll"><table><caption>Registros por intervalo · Chihuahua</caption><thead><tr><th>Intervalo</th><th>Cartas</th></tr></thead><tbody>{#each series as bucket}<tr><td><button type="button" on:click={() => openMetric('interval', bucket, bucket.count)}>{bucketLabel(bucket, true)}</button></td><td>{number.format(bucket.count)}</td></tr>{/each}</tbody></table></div></details>
      </article>
      <article class="panel">
        <div class="panel-heading"><div><h3>Estado de las cartas</h3><p>Estado actual de las cartas del periodo</p></div></div>
        <div class="donut">
          <svg viewBox="0 0 200 200" role="img" aria-label={`Distribución por estado de ${number.format(data.total)} cartas. Conteos y porcentajes en la leyenda.`}>
            <circle cx="100" cy="100" r="70" fill="none" stroke="#eceeea" stroke-width="26" />
            {#each segments as segment}<circle cx="100" cy="100" r="70" fill="none" stroke={colors[segment.status]} stroke-width="26" pathLength="100" stroke-dasharray={`${segment.percentage} ${100 - segment.percentage}`} stroke-dashoffset={-segment.offset} transform="rotate(-90 100 100)" />{/each}
          </svg><div class="donut-total"><strong>{number.format(data.total)}</strong><span>cartas</span></div>
        </div>
        <ul class="legend">{#each states as state}<li><button type="button" class="legend-link" on:click={() => openMetric('state', state, state.count)}><span class="dot" style:background={colors[state.status]}></span><span>{stateLabels[state.status]}</span><strong>{number.format(state.count)}</strong><small>{percent.format(state.percentage)}%</small></button></li>{/each}</ul>
      </article>
    </div>
    <div class="breakdowns">
      <article class="panel"><div class="panel-heading"><div><h3>Registros por atracción</h3><p>Atracciones originales de las cartas</p></div></div>
        {#if !attractions.length}<p class="empty">No hay atracciones que mostrar en este periodo.</p>{/if}
        <ul class="bars">{#each attractions as row}<li><button type="button" class="bar-link" on:click={() => openMetric('attraction', row, row.count)}><span class="bar-label"><span>{row.name}</span><span><strong>{number.format(row.count)}</strong> <small>({percent.format(row.percentage)}%)</small></span></span><span class="track" aria-hidden="true"><span style:width={`${Math.min(100, row.percentage)}%`}></span></span></button></li>{/each}</ul>
        <p class="footnote">Una carta puede incluir varias atracciones. La suma por atracción puede superar el total de cartas. No incluye actividades adicionales.</p>
      </article>
      <article class="panel"><div class="panel-heading"><div><h3>Procedencia de visitantes</h3><p>Procedencia registrada en las cartas del periodo</p></div></div>
        {#if !provenance.length}<p class="empty">No hay procedencias que mostrar en este periodo.</p>{/if}
        <ul class="bars">{#each provenance as row}<li><button type="button" class="bar-link" on:click={() => openMetric('provenance', row, row.count)}><span class="bar-label"><span>{row.category}</span><span><strong>{number.format(row.count)}</strong> <small>({percent.format(row.percentage)}%)</small></span></span><span class="track" aria-hidden="true"><span style:width={`${Math.min(100, row.percentage)}%`}></span></span></button></li>{/each}</ul>
        <p class="footnote">Solo se agrupan estados mexicanos reconocibles. Los datos ausentes o ambiguos conservan su categoría explícita.</p>
      </article>
    </div>
    <p class="updated">Última actualización correcta: {new Date(data.generatedAt).toLocaleString('es-MX', { timeZone: PARK_TIME_ZONE })} · Chihuahua</p>
  {/if}
</section>

<style>
  button:disabled { opacity: 0.65; cursor: wait; }
  .stat { text-align: left; } .historical { width: 100%; text-align: left; }
  .legend-link { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; }
  .legend-link > span:nth-child(2) { flex: 1; }
  .bar-link { display: block; width: 100%; text-align: left; padding: 8px; }
  .track, .track > span { display: block; } .track > span { background: #285e49; height: 100%; border-radius: inherit; }
  .bars li:first-child .track > span { background: #c99728; }
  .trend-chart a:focus .point { stroke: #a16d09; stroke-width: 5; }
  .dashboard { color: #183c31; background: #f7f6f0; border-radius: 18px; padding: 24px; }
  h2, h3, p { margin: 0; } h2 { font-size: 30px; } h3 { font-size: 19px; } p, small { color: #60676a; } p { margin-top: 6px; font-size: 14px; }
  button, input { font: inherit; } button { background: white; border: 1px solid #d7ded8; border-radius: 9px; padding: 10px 13px; color: #183c31; cursor: pointer; min-height: 42px; }
  button:hover { background: #edf3ee; } button:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #ac7915; outline-offset: 3px; }
  .heading, .panel-heading, .stat-title { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
  .heading { flex-wrap: wrap; } .controls { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; } .periods { display: flex; gap: 3px; background: #ecece5; padding: 4px; border-radius: 11px; }
  .periods button { border: none; background: transparent; } .periods button.selected { background: #214d3c; color: white; } label { display: grid; gap: 5px; font-size: 13px; color: #60676a; } input { background: white; border: 1px solid #d7ded8; border-radius: 9px; padding: 10px; min-height: 20px; }
  .navigation { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 18px 0; } .navigation span { font-size: 12px; color: #60676a; margin-left: auto; }
  .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
  .stat, .panel { background: white; border: 1px solid #e0e4de; border-radius: 15px; padding: 20px; min-width: 0; } .stat { border-top: 3px solid #c99728; }
  .stat h3 { font-size: 14px; font-weight: 600; } .stat strong { font-size: clamp(25px, 3vw, 38px); display: block; margin: 8px 0; overflow-wrap: anywhere; } .stat small { display: block; margin-top: 8px; font-size: 12px; }
  .stat-icon { color: #a16d09; background: #fbf4e5; padding: 5px 9px; border-radius: 50%; }
  .historical { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 18px 0; padding: 14px 18px; border: 1px solid #d8e2d8; border-radius: 12px; background: #edf4ee; } .historical strong { font-size: 24px; } .historical small { margin-left: auto; }
  .selection { margin: 18px 0; } .charts { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 18px; } .breakdowns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
  .badge { border: 1px solid #f0dfba; background: #fbf6ec; color: #725009; border-radius: 20px; padding: 7px 12px; white-space: nowrap; font-size: 13px; }
  .plot { overflow-x: auto; } .plot:focus-visible { outline: 3px solid #ac7915; outline-offset: 2px; }
  .trend-chart { display: block; width: 100%; height: auto; margin-top: 20px; } .trend-chart text { font-size: 12px; fill: #626b68; }
  .donut { width: 210px; max-width: 100%; margin: 18px auto; position: relative; } .donut svg { display: block; width: 100%; } .donut-total { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; flex-direction: column; pointer-events: none; } .donut-total strong { font-size: 25px; } .donut-total span { color: #60676a; font-size: 13px; }
  ul { list-style: none; padding: 0; margin: 18px 0 0; } .legend li { display: flex; gap: 8px; align-items: center; background: #f7f8f6; padding: 9px; margin-top: 5px; border-radius: 7px; font-size: 13px; } .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; } .legend small { min-width: 42px; text-align: right; }
  .bars li { margin: 16px 0; } .bar-label { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; } .bar-label > span:first-child { overflow-wrap: anywhere; } .bar-label > span:last-child { flex-shrink: 0; } .track { background: #eeefec; border-radius: 6px; margin-top: 8px; height: 7px; overflow: hidden; }
  .footnote, .updated { font-size: 12px; line-height: 1.5; } .footnote { border-top: 1px solid #e7eae4; padding-top: 12px; margin-top: 18px; } .updated { margin-top: 18px; text-align: right; }
  .notice { padding: 30px 15px; background: white; border-radius: 12px; } .error { border: 1px solid #bd4141; } .error button { margin-top: 15px; } .empty { padding: 15px 0; } summary { color: #285e49; cursor: pointer; padding: 12px 0; } table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { padding: 8px; border-bottom: 1px solid #e7eae4; text-align: left; } caption { padding: 8px; color: #60676a; } .table-scroll { max-height: 280px; overflow: auto; }
  @media (max-width: 1050px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .charts { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 650px) { .trend-chart { min-width: 600px; } .dashboard { padding: 14px; } .breakdowns { grid-template-columns: minmax(0, 1fr); } .heading { gap: 18px; } .controls { width: 100%; } .navigation span { margin-left: 0; width: 100%; } .panel { padding: 16px; } .historical small { margin-left: 0; width: 100%; } .panel-heading { flex-wrap: wrap; } .stat { padding: 14px; } .bar-label { flex-wrap: wrap; } }
  @media (max-width: 380px) { .cards { grid-template-columns: minmax(0, 1fr); } .periods { flex-wrap: wrap; } }
</style>
