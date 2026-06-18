<script>
  import { sanitizeWaiverHtml } from "../lib/waiverHtml.js";

  export let content = "";

  $: safeHtml = sanitizeWaiverHtml(content);
</script>

<div class="waiver waiver-html">{@html safeHtml}</div>

<style>
  .waiver {
    background: #fff;
    padding: 10px;
    border: 1px solid #e7dbc8;
    border-radius: 6px;
    line-height: 1.45;
    color: #1f4a3b;
  }
  .waiver :global(p) {
    margin: 0 0 0.75em;
  }
  .waiver :global(p:last-child) {
    margin-bottom: 0;
  }
  .waiver :global(h2),
  .waiver :global(h3) {
    margin: 0.5em 0 0.35em;
    font-size: 1rem;
    font-weight: 700;
  }
  .waiver :global(ul),
  .waiver :global(ol) {
    margin: 0 0 0.75em 1.25em;
    padding: 0;
  }
  .waiver :global(strong),
  .waiver :global(b) {
    font-weight: 700;
  }
  .waiver :global(mark) {
    background-color: #fef08a;
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }
</style>
