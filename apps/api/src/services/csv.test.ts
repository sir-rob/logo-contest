import { describe, expect, it } from 'vitest';
import { ApiError, formatAlias } from '@contest/shared';
import { anonymousBallotId, ballotsToCsv, escapeCsvCell, orderRankingsAnonymously, rankingHash } from './csv.js';

const CRLF = '\r\n';

/** Split a CSV body into records, keeping the CRLF check separate. */
const lines = (csv: string): string[] => csv.split(CRLF).slice(0, -1);

/** Alias lookup over a plain map; anything unknown returns null. */
const aliasFrom = (map: Record<string, string>) => (id: string): string | null => map[id] ?? null;

describe('escapeCsvCell', () => {
  it('leaves ordinary cells alone', () => {
    expect(escapeCsvCell('Entry 07')).toBe('Entry 07');
    expect(escapeCsvCell('')).toBe('');
  });

  it('quotes a cell containing a comma', () => {
    expect(escapeCsvCell('Entry 07, revised')).toBe('"Entry 07, revised"');
  });

  it('quotes and doubles internal double quotes', () => {
    expect(escapeCsvCell('the "good" one')).toBe('"the ""good"" one"');
    expect(escapeCsvCell('"')).toBe('""""');
  });

  it('quotes a cell containing a newline or carriage return', () => {
    expect(escapeCsvCell('two\nlines')).toBe('"two\nlines"');
    expect(escapeCsvCell('two\r\nlines')).toBe('"two\r\nlines"');
  });

  it('passes unicode through untouched — the file is UTF-8 with no BOM', () => {
    expect(escapeCsvCell('Entrée ✨ 日本')).toBe('Entrée ✨ 日本');
  });
});

describe('ballotsToCsv — header and framing', () => {
  it('emits the exact header row for maxRanks = 5', () => {
    const csv = ballotsToCsv([], () => null, 5);
    expect(lines(csv)[0]).toBe('ballot_id,rank_1,rank_2,rank_3,rank_4,rank_5');
  });

  it('narrows the header when the contest caps ranks lower', () => {
    expect(lines(ballotsToCsv([], () => null, 3))[0]).toBe('ballot_id,rank_1,rank_2,rank_3');
  });

  it('uses CRLF line endings and terminates the final record', () => {
    const csv = ballotsToCsv([['a'], ['b']], aliasFrom({ a: 'Entry 01', b: 'Entry 02' }), 2);
    expect(csv.endsWith(CRLF)).toBe(true);
    // Every newline is part of a CRLF pair — no bare LF anywhere.
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    expect(lines(csv)).toHaveLength(3); // header + 2 ballots
  });

  it('emits no BOM', () => {
    expect(ballotsToCsv([['a']], () => 'Entry 01', 1).charCodeAt(0)).not.toBe(0xfeff);
  });

  it('rejects a nonsensical column count rather than emitting a broken file', () => {
    expect(() => ballotsToCsv([], () => null, 0)).toThrow(ApiError);
    expect(() => ballotsToCsv([], () => null, 1.5)).toThrow(ApiError);
  });
});

describe('ballotsToCsv — cells', () => {
  it('pads a short ballot to maxRanks with empty cells', () => {
    const csv = ballotsToCsv([['a', 'b']], aliasFrom({ a: 'Entry 01', b: 'Entry 02' }), 5);
    expect(lines(csv)[1]).toBe('B001,Entry 01,Entry 02,,,');
  });

  it('truncates an over-long ballot so every row has the same arity', () => {
    const csv = ballotsToCsv([['a', 'b', 'c']], aliasFrom({ a: 'E1', b: 'E2', c: 'E3' }), 2);
    expect(lines(csv)[1]).toBe('B001,E1,E2');
  });

  it('writes an EMPTY cell when the alias lookup misses — never the raw id', () => {
    const csv = ballotsToCsv([['a', 'ghost-submission-id']], aliasFrom({ a: 'Entry 01' }), 3);
    expect(lines(csv)[1]).toBe('B001,Entry 01,,');
    expect(csv).not.toContain('ghost-submission-id');
  });

  it('escapes aliases that would otherwise break the row', () => {
    const csv = ballotsToCsv([['a', 'b', 'c']], aliasFrom({ a: 'Entry, 01', b: 'the "one"', c: 'two\nlines' }), 3);
    expect(lines(csv)[1]).toBe('B001,"Entry, 01","the ""one""","two\nlines"');
  });

  it('carries unicode aliases verbatim', () => {
    const csv = ballotsToCsv([['a']], aliasFrom({ a: 'Entrée ✨' }), 1);
    expect(lines(csv)[1]).toBe('B001,Entrée ✨');
  });

  it('uses the shared alias format, so the file reads like the gallery', () => {
    const csv = ballotsToCsv([['a']], () => formatAlias(7), 1);
    expect(lines(csv)[1]).toBe('B001,Entry 07');
  });
});

describe('ballotsToCsv — anonymous ballot ids', () => {
  const rankings = [['a', 'b'], ['b', 'c', 'a'], ['c'], ['a', 'c'], ['b']];
  const aliases = aliasFrom({ a: 'Entry 01', b: 'Entry 02', c: 'Entry 03' });

  it('numbers rows sequentially from B001', () => {
    const ids = lines(ballotsToCsv(rankings, aliases, 3))
      .slice(1)
      .map((row) => row.split(',')[0]);
    expect(ids).toEqual(['B001', 'B002', 'B003', 'B004', 'B005']);
  });

  it('produces identical output for the same ballots in a different order', () => {
    const forwards = ballotsToCsv(rankings, aliases, 3);
    const backwards = ballotsToCsv([...rankings].reverse(), aliases, 3);
    expect(backwards).toBe(forwards);
  });

  it('is stable across repeated calls', () => {
    expect(ballotsToCsv(rankings, aliases, 3)).toBe(ballotsToCsv(rankings, aliases, 3));
  });

  it('never emits a submission id', () => {
    const csv = ballotsToCsv(rankings, aliases, 3);
    for (const id of ['a', 'b', 'c']) {
      expect(csv.split(CRLF).slice(1).join(CRLF)).not.toContain(`,${id},`);
    }
  });

  it('pads ids to three digits and keeps growing past 999', () => {
    expect(anonymousBallotId(0)).toBe('B001');
    expect(anonymousBallotId(98)).toBe('B099');
    expect(anonymousBallotId(999)).toBe('B1000');
    expect(anonymousBallotId(0, 'b')).toBe('b001');
  });
});

describe('rankingHash / orderRankingsAnonymously', () => {
  it('distinguishes rankings that differ only in where the boundary falls', () => {
    expect(rankingHash(['ab', 'c'])).not.toBe(rankingHash(['a', 'bc']));
  });

  it('is order-sensitive — a different preference order is a different ballot', () => {
    expect(rankingHash(['a', 'b'])).not.toBe(rankingHash(['b', 'a']));
  });

  it('orders by ranking hash, so input order cannot leak', () => {
    const input = [['c'], ['a'], ['b']];
    const once = orderRankingsAnonymously(input);
    const twice = orderRankingsAnonymously([...input].reverse());
    expect(twice).toEqual(once);
  });

  it('preserves every ballot', () => {
    const input = [['a'], ['a'], ['b']];
    expect(orderRankingsAnonymously(input)).toHaveLength(3);
  });

  it('does not mutate its input', () => {
    const input = [['c'], ['a']];
    orderRankingsAnonymously(input);
    expect(input).toEqual([['c'], ['a']]);
  });
});
