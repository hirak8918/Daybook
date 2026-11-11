import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import type { Note } from '../lib/schema';
import { NOTE_TITLE_MAX } from '../lib/schema';
import { IconArrowRight, IconTrash } from './Icons';
import { ConfirmDialog } from './Overlays';

/**
 * Font size as a real text-style attribute. Mark attributes must be declared by
 * an extension or ProseMirror drops them, so this adds one global attribute to
 * the TextStyle mark and renders it as an inline size.
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

type SaveState = 'saved' | 'dirty';

/**
 * One note. The title and body both save, explicitly with the Save button and
 * quietly in the background after a pause so closing the app never loses a
 * sentence. The editor's schema only knows paragraphs, hard breaks, bold,
 * italic, underline and the size mark.
 */
export function NoteEditor({
  note,
  onBack,
  onSave,
  onDelete,
}: {
  note: Note;
  onBack: () => void;
  onSave: (patch: { title: string; html: string }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<SaveState>('saved');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<number | null>(null);
  const savedTitle = useRef(note.title);
  const savedHtml = useRef(note.html);
  const html = useRef(note.html);
  const titleRef = useRef(note.title);
  const saveRef = useRef(onSave);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

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
    content: note.html,
    editorProps: {
      attributes: {
        class: 'note-prose',
        'aria-label': 'Note body',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: current }) => {
      html.current = current.isEmpty ? '' : current.getHTML();
      setStatus('dirty');
      schedule();
    },
    onBlur: ({ editor: current }) => {
      html.current = current.isEmpty ? '' : current.getHTML();
      commit();
    },
  });

  const commit = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
    const cleanTitle = titleRef.current.trim().slice(0, NOTE_TITLE_MAX) || 'Untitled note';
    if (cleanTitle === savedTitle.current && html.current === savedHtml.current) {
      setStatus('saved');
      return;
    }
    savedTitle.current = cleanTitle;
    savedHtml.current = html.current;
    saveRef.current({ title: cleanTitle, html: html.current });
    setStatus('saved');
  }, []);

  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  function schedule() {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      commitRef.current();
    }, 650);
  }

  useEffect(() => {
    if (!editor) return;
    const update = () => forceUpdate();
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  useEffect(() => {
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      commitRef.current();
    };
  }, []);

  if (!editor) {
    return <div className="min-h-0 flex-1" aria-hidden="true" />;
  }

  const activeSize = editor.getAttributes('textStyle').fontSize as string | undefined;

  const back = () => {
    commit();
    onBack();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Note editor">
      <div className="flex shrink-0 items-center gap-2 border-b border-rule px-3 py-2">
        <button
          type="button"
          className="btn-text no-rule -ml-1 shrink-0 px-1.5"
          aria-label="All notes"
          title="All notes"
          onClick={back}
        >
          <IconArrowRight size={15} className="rotate-180" />
        </button>
        <input
          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-mute"
          value={title}
          aria-label="Note title"
          maxLength={NOTE_TITLE_MAX}
          placeholder="Untitled note"
          onChange={(event) => {
            setTitle(event.target.value);
            setStatus('dirty');
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
          }}
        />

        <span className="hidden shrink-0 font-text text-micro text-ink-mute sm:block" aria-live="polite">
          {status === 'saved' ? 'Saved' : 'Unsaved'}
        </span>
        <button type="button" className="btn btn-primary h-8 min-h-0 shrink-0 px-3" onClick={commit} aria-label="Save note">
          Save
        </button>
        <button
          type="button"
          className="btn-text no-rule -mr-1 shrink-0 px-1"
          aria-label="Delete note"
          title="Delete note"
          onClick={() => setConfirmDelete(true)}
        >
          <IconTrash size={15} />
        </button>
      </div>

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

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        body={<p>“{title.trim() || 'Untitled note'}” will be removed. There is no undo in the app.</p>}
        confirmLabel="Delete note"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
      />
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
