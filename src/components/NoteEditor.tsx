import { useEffect, useReducer, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import { useData, useStoreApi } from '../lib/store';

/**
 * Font size as a real text-style attribute. Mark attributes must be declared by
 * an extension or ProseMirror drops them, so this adds one global attribute to
 * the TextStyle mark and renders it as an inline size. Sizes are the familiar
 * Word-style steps, chosen from one compact menu.
 */
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize ? { style: `font-size: ${String(attributes.fontSize)}` } : {},
          },
        },
      },
    ];
  },
});

const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;

/**
 * The Home note sheet. One document-level note, saved as the editor emits it:
 * the editor's schema only knows paragraphs, hard breaks, bold, italic,
 * underline and the size mark, so pasted markup cannot smuggle anything else
 * into the file. Saves are debounced and flushed on blur and unmount.
 */
export function NoteEditor() {
  const data = useData();
  const store = useStoreApi();
  const initial = useRef(data.notes?.html ?? '');
  const saved = useRef(initial.current);
  const pending = useRef<number | null>(null);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: initial.current,
    editorProps: {
      attributes: {
        class: 'note-prose',
        'aria-label': 'Notes',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: current }) => {
      schedule(current.isEmpty ? '' : current.getHTML());
    },
    onBlur: ({ editor: current }) => {
      flush(current.isEmpty ? '' : current.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    const update = () => forceUpdate();
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      const html = editor.isEmpty ? '' : editor.getHTML();
      if (html !== saved.current) store.dispatch({ type: 'note/set', html });
    };
  }, [editor, store]);

  function schedule(html: string) {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      flush(html);
    }, 400);
  }

  function flush(html: string) {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
    if (html === saved.current) return;
    saved.current = html;
    store.dispatch({ type: 'note/set', html });
  }

  if (!editor) {
    return <div className="min-h-0 flex-1" aria-hidden="true" />;
  }

  const activeSize = editor.getAttributes('textStyle').fontSize as string | undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Notes">
      <div className="flex shrink-0 items-center gap-1 border-b border-rule px-3 py-2">
        <FormatButton
          label="Bold"
          shortcut="Ctrl+B"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <span className="font-semibold">B</span>
        </FormatButton>
        <FormatButton
          label="Italic"
          shortcut="Ctrl+I"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </FormatButton>
        <FormatButton
          label="Underline"
          shortcut="Ctrl+U"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span className="underline">U</span>
        </FormatButton>

        <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-rule" />

        <label htmlFor="note-size" className="sr-only">
          Text size
        </label>
        <select
          id="note-size"
          aria-label="Text size"
          value={activeSize ? String(parseFloat(activeSize)) : ''}
          onChange={(event) => {
            const value = event.target.value;
            const chain = editor.chain().focus();
            if (!value) chain.unsetMark('textStyle').run();
            else chain.setMark('textStyle', { fontSize: `${value}px` }).run();
          }}
          className="h-8 rounded-[6px] border border-rule bg-paper-raise px-2 font-text text-[12px] text-ink-soft outline-none transition-colors hover:border-rule-strong focus:border-accent"
        >
          <option value="">Size</option>
          {SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="note-editor min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function FormatButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={`${label} (${shortcut})`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-[6px] font-text text-small transition-colors ${
        active ? 'bg-accent-wash text-accent-deep' : 'text-ink-soft hover:bg-paper-deep hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
