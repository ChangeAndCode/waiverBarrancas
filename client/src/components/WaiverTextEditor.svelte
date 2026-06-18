<script>
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";

  export let value = "";

  let element;
  let editor;

  function run(command, attrs = undefined) {
    return () => {
      if (!editor) return;
      const chain = editor.chain().focus();
      if (attrs !== undefined) chain[command](attrs).run();
      else chain[command]().run();
    };
  }

  function isActive(name, attrs = {}) {
    return editor?.isActive(name, attrs) ?? false;
  }

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3] }
        })
      ],
      content: value || "<p></p>",
      editorProps: {
        attributes: {
          class: "waiver-editor-prose"
        }
      },
      onUpdate({ editor: ed }) {
        value = ed.getHTML();
      }
    });

    return () => {
      editor?.destroy();
      editor = null;
    };
  });

  onDestroy(() => {
    editor?.destroy();
    editor = null;
  });
</script>

<div class="waiver-editor">
  <div class="waiver-editor-toolbar" role="toolbar" aria-label="Formato del waiver">
    <button type="button" class:active={isActive("bold")} on:click={run("toggleBold")} title="Negrita">
      <b>B</b>
    </button>
    <button type="button" class:active={isActive("italic")} on:click={run("toggleItalic")} title="Cursiva">
      <i>I</i>
    </button>
    <button type="button" class:active={isActive("heading", { level: 3 })} on:click={run("toggleHeading", { level: 3 })} title="Subtítulo">
      H
    </button>
    <button type="button" class:active={isActive("bulletList")} on:click={run("toggleBulletList")} title="Lista con viñetas">
      •
    </button>
    <button type="button" class:active={isActive("orderedList")} on:click={run("toggleOrderedList")} title="Lista numerada">
      1.
    </button>
  </div>
  <div class="waiver-editor-surface" bind:this={element}></div>
</div>

<style>
  .waiver-editor {
    border: 1px solid #d5c5ad;
    border-radius: 6px;
    background: #fff;
    overflow: hidden;
  }
  .waiver-editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
    border-bottom: 1px solid #ebdfcc;
    background: #f7f0e4;
  }
  .waiver-editor-toolbar button {
    min-width: 36px;
    min-height: 36px;
    padding: 6px 10px;
    border: 1px solid #d5c5ad;
    border-radius: 6px;
    background: #fff;
    color: #1f4a3b;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .waiver-editor-toolbar button.active {
    background: #1f4a3b;
    color: #fff;
    border-color: #1f4a3b;
  }
  .waiver-editor-surface {
    min-height: 220px;
    padding: 10px;
  }
  .waiver-editor-surface :global(.waiver-editor-prose) {
    outline: none;
    min-height: 200px;
    line-height: 1.45;
    color: #1f4a3b;
  }
  .waiver-editor-surface :global(.waiver-editor-prose p) {
    margin: 0 0 0.75em;
  }
  .waiver-editor-surface :global(.waiver-editor-prose h2),
  .waiver-editor-surface :global(.waiver-editor-prose h3) {
    margin: 0.5em 0 0.35em;
    font-size: 1rem;
    font-weight: 700;
  }
  .waiver-editor-surface :global(.waiver-editor-prose ul),
  .waiver-editor-surface :global(.waiver-editor-prose ol) {
    margin: 0 0 0.75em 1.25em;
    padding: 0;
  }
</style>
