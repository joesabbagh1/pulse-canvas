import { describe, expect, it } from 'vitest';
import { DeckSession } from './session';

describe('deck session', () => {
  it('refuses a command when no page is open', async () => {
    const session = new DeckSession(50, 1000);
    await expect(session.ask({ op: 'look' })).rejects.toThrow(/not connected/);
    session.close();
  });

  it('hands a command to the waiting page', async () => {
    const session = new DeckSession(500, 5000);
    const pending = session.pull(500);
    const result = session.ask({ op: 'look' });
    const pull = await pending;
    expect(pull).toMatchObject({ status: 'job', command: { op: 'look' } });
    if (pull.status !== 'job') return;
    expect(session.reply(pull.id, { ok: true, text: 'Night' })).toBe(true);
    await expect(result).resolves.toEqual({ ok: true, text: 'Night' });
    session.close();
  });

  it('tells a second tab to wait', async () => {
    const session = new DeckSession(500, 5000);
    const first = session.pull(500);
    await expect(session.pull(500)).resolves.toEqual({ status: 'busy' });
    session.close();
    await first;
  });

  it('keeps a command until the next pull', async () => {
    const session = new DeckSession(500, 5000);
    await session.pull(30);
    const result = session.ask({ op: 'transport', action: 'play' });
    const pull = await session.pull(500);
    expect(pull).toMatchObject({ status: 'job', command: { action: 'play' } });
    if (pull.status !== 'job') return;
    session.reply(pull.id, { ok: true, text: 'Playing' });
    await expect(result).resolves.toMatchObject({ ok: true, text: 'Playing' });
    session.close();
  });

  it('gives up when the page never answers', async () => {
    const session = new DeckSession(40, 5000);
    const pending = session.pull(500);
    const result = session.ask({ op: 'look' });
    const pull = await pending;
    await expect(result).rejects.toThrow(/did not answer/);
    if (pull.status === 'job') expect(session.reply(pull.id, { ok: true, text: 'late' })).toBe(false);
    session.close();
  });
});
