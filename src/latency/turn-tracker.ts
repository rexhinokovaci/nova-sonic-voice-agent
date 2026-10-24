// Per-turn timings, measured where the caller feels them:
//  ttfa      user finished speaking -> first assistant audio chunk
//  tools     each tool call round trip
//  bargeIns  times the user talked over the assistant

export interface TurnMetrics {
  turn: number;
  ttfaMs?: number;
  tools: Array<{ name: string; ms: number; ok: boolean }>;
  bargeIns: number;
  assistantChars: number;
}

export class TurnTracker {
  private turn = 0;
  private userEndAt?: number;
  private firstAudioAt?: number;
  private current: TurnMetrics = { turn: 0, tools: [], bargeIns: 0, assistantChars: 0 };

  constructor(private readonly now: () => number = () => performance.now()) {}

  userTurnEnded(): void {
    this.turn++;
    this.userEndAt = this.now();
    this.firstAudioAt = undefined;
    this.current = { turn: this.turn, tools: [], bargeIns: 0, assistantChars: 0 };
  }

  assistantAudio(): void {
    if (this.userEndAt !== undefined && this.firstAudioAt === undefined) {
      this.firstAudioAt = this.now();
      this.current.ttfaMs = this.firstAudioAt - this.userEndAt;
    }
  }

  assistantText(text: string): void {
    this.current.assistantChars += text.length;
  }

  tool(name: string, ms: number, ok: boolean): void {
    this.current.tools.push({ name, ms, ok });
  }

  bargeIn(): void {
    this.current.bargeIns++;
  }

  snapshot(): TurnMetrics {
    return { ...this.current, tools: [...this.current.tools] };
  }
}
