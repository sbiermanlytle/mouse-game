// All tunable gameplay constants live here. Units are tiles and seconds
// unless noted. Tweak freely — nothing else in the codebase hardcodes these.
export const CONFIG = {
  TILE: 32,            // logical pixels per tile (world unit)
  VIEW_TILES_X: 12,    // target visible width in tiles (portrait)
  VIEW_TILES_Y: 20,    // target visible height in tiles

  // Mouse movement
  SNEAK_SPEED: 2.0,    // tiles/sec, silent
  SCURRY_SPEED: 4.2,   // tiles/sec, noisy
  MOUSE_RADIUS: 0.28,

  // Noise radii (human investigates if within radius of the sound)
  SCURRY_NOISE_RADIUS: 6,
  CREAK_NOISE_RADIUS: 8,
  CORK_NOISE_RADIUS: 10,
  SCURRY_NOISE_INTERVAL: 0.35, // how often a scurrying mouse re-emits noise

  // Human vision
  VISION_ARC: (70 * Math.PI) / 180,
  VISION_RANGE: 5,
  VISION_RANGE_DARK: 2,
  VISION_RAYS: 26,          // rays used to draw the occluded cone polygon

  // Detection / capture
  EYE_CAPTURE_TIME: 1.5,    // continuous seconds in cone before capture
  EYE_DECAY_RATE: 2.5,      // eye meter drain per second once out of cone
  EYE_DECAY_GRACE: 0.35,    // seconds out of cone before the meter starts draining
  CHASE_MEMORY: 3.0,        // seconds a human keeps chasing after losing sight
  CHASE_SPEED_MULT: 1.55,
  CHASE_REPATH: 0.4,
  HUMAN_SPEED: 2.1,
  HUMAN_CONTACT_R: 0.62,    // touching a human = instant capture
  SENTRY_ROT_SPEED: 0.85,   // rad/sec for rotating sentries
  SCAN_TIME: 2.2,           // look-around time when investigating a noise
  SUSPICION_PAUSE: 3.0,     // stare time at furniture the mouse was seen hiding under
  SEEN_HIDE_WINDOW: 1.0,    // if human saw mouse this recently when it hides -> suspicious

  // Cat
  CAT_DETECT_RADIUS: 2.4,   // 360° detection
  CAT_SPEED: 1.3,
  CAT_CHASE_SPEED: 3.5,
  CAT_CONTACT_R: 0.5,
  CAT_GIVEUP_DIST: 6,
  CAT_GIVEUP_TIME: 4,
  CAT_LURE_RADIUS: 8,       // crumb lure range
  CAT_EAT_TIME: 6,
  CAT_HOLE_FOLLOW_DELAY: 0.8, // delay before cat follows through a mouse hole
  CAT_REPATH: 0.35,

  // Interaction
  NIBBLE_TIME: 1.0,         // hold-to-win duration
  NIBBLE_RANGE: 1.15,
  GRAB_RANGE: 1.0,
  USE_RANGE: 1.6,           // reach for doors/windows/holes/cords
  INVENTORY_SIZE: 2,
  CORK_CLATTER_DELAY: 0.5,  // dropped cork makes noise after this delay

  // Capture penalty: levels 1..N keep collected items on capture, later
  // levels respawn uncollected inventory (unlocked doors always stay open).
  KEEP_ITEMS_THROUGH_LEVEL: 3,

  // Windows
  WINDOW_OPEN_TIME: 3.5,    // timer windows: seconds open
  WINDOW_CLOSE_TIME: 5.0,   // seconds closed

  // Mouse holes
  HOLE_COOLDOWN: 0.7,       // seconds before the mouse can re-enter a hole

  // Camera
  CAMERA_LOOKAHEAD: 1.5,    // tiles ahead of movement direction
  CAMERA_LERP: 5,

  // Touch input
  JOY_DEADZONE: 10,         // px
  JOY_FULL: 62,             // px drag for full speed
  JOY_SNEAK_FRAC: 0.6,      // below this fraction of full drag = sneak

  // Presentation
  WIPE_TIME: 1.25,          // capture screen-wipe duration
  TAIL_SEGMENTS: 3,
};
