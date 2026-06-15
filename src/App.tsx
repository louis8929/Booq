import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AudioMeta, Transcription } from './types';
import UploadScreen from './components/UploadScreen';
import EditScreen from './components/EditScreen';
import PracticeScreen from './components/PracticeScreen';
import ThemeToggle from './components/ThemeToggle';

export interface Session {
  /** Recording to play; null for synthesized (MIDI-import) sessions. */
  file: Blob | null;
  meta: AudioMeta;
  /** Decoded audio for analysis; absent for MIDI-import sessions. */
  buffer?: AudioBuffer | null;
  transcription: Transcription;
}

type Screen = 'upload' | 'edit' | 'practice';

export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [session, setSession] = useState<Session | null>(null);

  const handleAnalyzed = useCallback((s: Session) => {
    setSession(s);
    setScreen('edit');
  }, []);

  const updateTranscription = useCallback((t: Transcription) => {
    setSession((prev) => (prev ? { ...prev, transcription: t } : prev));
  }, []);

  // Used when attaching the original recording to a MIDI-import session:
  // the whole session (file/buffer/transcription) is swapped at once.
  const replaceSession = useCallback((s: Session) => setSession(s), []);

  // Global shortcut: Escape returns to the editor from practice mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && screen === 'practice') setScreen('edit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 print:hidden">
        <button
          className="flex items-center gap-2 group"
          onClick={() => setScreen(session ? 'edit' : 'upload')}
          title="Home"
        >
          <span className="text-2xl">🥁</span>
          <h1 className="text-lg font-bold tracking-tight">
            Drum<span className="text-amber-500">Scribe</span>
          </h1>
        </button>
        <nav className="flex items-center gap-2">
          {session && (
            <>
              <NavButton active={screen === 'edit'} onClick={() => setScreen('edit')}>
                ✏️ Edit
              </NavButton>
              <NavButton active={screen === 'practice'} onClick={() => setScreen('practice')}>
                ▶ Practice
              </NavButton>
              <NavButton active={false} onClick={() => { setSession(null); setScreen('upload'); }}>
                ＋ New
              </NavButton>
            </>
          )}
          <ThemeToggle />
        </nav>
      </header>

      <main className="flex-1 flex flex-col">
        <ErrorBoundary key={screen} onReset={() => setScreen(session ? 'edit' : 'upload')}>
          {screen === 'upload' && <UploadScreen onAnalyzed={handleAnalyzed} />}
          {screen === 'edit' && session && (
            <EditScreen
              session={session}
              onChange={updateTranscription}
              onReplaceSession={replaceSession}
              onPractice={() => setScreen('practice')}
            />
          )}
          {screen === 'practice' && session && (
            <PracticeScreen session={session} onBack={() => setScreen('edit')} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Without this, any runtime error inside a screen unmounts the whole app —
 * which reads as "the button does nothing" / a blank page to the user.
 */
class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-3xl">😵</p>
          <p className="font-semibold">Something went wrong on this screen.</p>
          <p className="text-sm text-zinc-500 max-w-md break-words">{this.state.error.message}</p>
          <button
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm"
          >
            Go back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-amber-500 text-white'
          : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}
