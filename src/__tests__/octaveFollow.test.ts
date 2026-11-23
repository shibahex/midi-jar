import { getFollowedOctaveShift } from '../renderer/views/ChordQuiz/utils';

// C major from C4 (keyboard C4–B5 at shift 0)
const C_MAJOR = [60, 64, 67];

describe('the keyboard following the octave played in', () => {
  it('stays for a stray note in another octave', () => {
    expect(getFollowedOctaveShift(C_MAJOR, [40], 0)).toBeNull();
  });

  it('stays when the whole chord is played within the keys shown', () => {
    expect(getFollowedOctaveShift(C_MAJOR, [72, 76, 79], 0)).toBeNull();
  });

  it('moves when the whole chord is played below the keys shown', () => {
    expect(getFollowedOctaveShift(C_MAJOR, [48, 52, 55], 0)).toBe(-1);
  });

  it('moves for a single note played outside the keys shown', () => {
    expect(getFollowedOctaveShift([62], [50], 0)).toBe(-1);
  });
});
