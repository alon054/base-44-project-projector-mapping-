/**
 * S2. A text input whose value commits 250 ms after the last keystroke, on
 * Enter, on blur and on unmount — through `TextCommitter`, the editor's one
 * debounce. See `debouncedText.ts` for why this exists and why it is not
 * "write on blur".
 *
 * The draft is local so typing is immediate; the committed value arrives back
 * through `value` and replaces the draft only when nothing is pending, so a
 * Load or an external edit shows up, but a half-typed word is never yanked
 * back to the last commit mid-keystroke.
 *
 * `onCommit` is read through a ref AT COMMIT TIME, never captured. The
 * callers close over the current tree (`withSurfaceRole(surfaces, …)`), and a
 * closure captured on the keystroke would, 250 ms later, write a tree that a
 * point drag in between had already moved on from — the room reverting under
 * the builder's hand. The ref is what makes the late write a write of the
 * present.
 *
 * This component does not write a parameter. `ParamControl` performs the
 * registry write inside the `onCommit` it passes here, and stays one of the
 * two writers the controls test names; this file must never spell that call.
 */
import { useEffect, useRef, useState } from 'react';
import { TextCommitter } from './debouncedText';

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

interface Props extends InputProps {
  value: string;
  onCommit: (value: string) => void;
}

export function DebouncedTextInput({ value, onCommit, onBlur, onKeyDown, ...rest }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const committer = useRef<TextCommitter | null>(null);
  if (committer.current === null) {
    committer.current = new TextCommitter((v) => commitRef.current(v));
  }

  // An external change lands while nothing is being typed.
  useEffect(() => {
    if (!committer.current!.pending) setDraft(value);
  }, [value]);

  // Unmount: a word typed and then the row deleted or the panel switched is
  // still written, not lost.
  useEffect(() => () => committer.current?.flush(), []);

  return (
    <input
      {...rest}
      type="text"
      value={draft}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setDraft(v);
        committer.current!.type(v);
      }}
      onBlur={(e) => {
        committer.current!.flush();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') committer.current!.flush();
        onKeyDown?.(e);
      }}
    />
  );
}
