/**
 * Sheet motion constants shared by the live sheet (./index) and the Lab replays (../lab/rules), so the comparison
 * runs on the numbers the sheet really uses.
 */
import { springFromRatio } from '../motion/spring';

/** a tap on the scrim this soon after opening is a ghost click from the tap that opened it (v20.0.7 "safe tap scrim") */
export const SCRIM_GRACE_MS = 260;

/** closing: critical, no bounce past the card */
export const CLOSE_CFG = springFromRatio(300, 1);
/** snapping back open after a release below the close line: a little bounce, carries the release velocity */
export const SNAP_CFG = springFromRatio(380, 0.78);
