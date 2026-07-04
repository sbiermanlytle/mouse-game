import type { LevelDef } from './engine.ts';

// =========================================================================
// LEVEL FORMAT
// =========================================================================
// Levels are ASCII tilemaps plus a small amount of metadata. Every line of
// a grid must be the same width (trailing spaces count as void).
//
// Static tiles:
//   '#'  wall (blocks everything, blocks vision)
//   ' '  void (outside the map)
//   '.'  grass          ','  garden path
//   '='  wood floor     '~'  creaky wood (makes noise even when sneaking)
//   '+'  kitchen tiles  '"'  rug / living room
//   '-'  bedroom carpet '_'  stone tile (bathroom / pantry / stairs)
//   '['  solid furniture (blocks movement + vision)
//   ']'  low furniture: the mouse can walk on it and press Hide to become
//        invisible; vision passes over it; humans/cats can't cross it
//
// Digits '0'-'9' are barriers, defined in `barriers`:
//   { type: 'door', color }   locked for the mouse until a matching key is
//                             used; humans walk through freely (they live
//                             here); cats can pass only once unlocked.
//   { type: 'window', mode }  'timer' windows cycle open/closed on their
//                             own; 'spool' windows need the spool item to
//                             climb through. Only the mouse uses windows.
//   A digit may occupy several tiles — they act as one barrier.
//
// Letters are markers:
//   'S' spawn, 'C' cheese (required, exactly one each)
//   Letters in `markers` are items/objects:
//     key (colored), cork, crumb, spool, cord (gnaw to darken its room
//     permanently), hole (paired mouse holes: enter one, pop out the
//     other; cats can follow when chasing, cork can plug them), cat.
//   Any other letter must appear in a human's `path` and is a patrol
//   waypoint. Humans walk waypoint to waypoint (BFS) and loop. A human
//   with `sentry: true` stands at its first waypoint rotating its cone.
//
// `darkRooms` lists marker/waypoint chars; the room containing each char
// starts with the lights off (human vision shrinks inside). Humans switch
// lights on when they enter a room and off when they leave.
//
// The floor under markers/barriers/furniture is inferred from the most
// common neighbouring floor tile, so maps stay readable.
// =========================================================================

export const LEVELS: LevelDef[] = [
  // ---------------------------------------------------------------------
  {
    name: 'The Yard & Porch',
    hint: 'Drag to move — a small drag sneaks quietly, a big drag scurries fast (and loud!). Find the key in the yard, dodge the porch watcher, unlock the door, and hold NIBBLE on the cheese.',
    grid: `
##################
#================#
#==C==[]=====]===#
#================#
#====[[==========#
#================#
########11########
#.....======.....#
#.....==a===.....#
#......,,,.......#
#..[]..,,,.......#
#......,,,...]...#
#......,,,.......#
#..k...,,,.......#
#......,,,..[]...#
#......,,,.......#
#......,,,.......#
#......,,,..S....#
#................#
##################`,
    barriers: { '1': { type: 'door', color: 'red' } },
    markers: { k: { type: 'key', color: 'red' } },
    humans: [{ path: 'a', sentry: true }],
  },

  // ---------------------------------------------------------------------
  {
    name: 'Studio Apartment',
    hint: 'The window only opens now and then — wait for it. Inside, stay out of the resident\'s cone: sneak behind them or press HIDE under the couch.',
    grid: `
##################
#"""""""""""#+C++#
#"a"""""""b"#++++#
#"""[[["""""#++++#
#"""[[["""""##2###
#""""""""""""====#
#"""]]"""""""=k==#
#"""""""""""#====#
#"d"""""""c"#====#
#"""""""""""#====#
######33##########
#.....,,.........#
#....,,,.....]...#
#.....,,.........#
#.....,,,....S...#
#................#
##################`,
    barriers: {
      '2': { type: 'door', color: 'blue' },
      '3': { type: 'window', mode: 'timer' },
    },
    markers: { k: { type: 'key', color: 'blue' } },
    humans: [{ path: 'abcd' }],
  },

  // ---------------------------------------------------------------------
  {
    name: 'The Kitchen House',
    hint: 'Two keys this time: blue opens the bedroom, red opens the kitchen. Cracked boards creak even when you sneak — the long way round is the quiet way.',
    grid: `
####################
#++++++++#---------#
#+C++[]++#--k--[]--#
#++++++++#---------#
#++++++++#----]----#
####33#######44#####
#=~====~==~~=====e~#
#====~~====~~======#
####==########==####
#""""""""""""""""""#
#"a""""""""""""b"""#
#""""[[[""""]]"""""#
#""""[[["""""""""""#
#""""""""""""""""""#
#"d""""j"""""""c"""#
#""""""""""""""""""#
########55##########
#......,,,.........#
#...[].,,,....]....#
#......,,,.........#
#......,,,....S....#
#..................#
####################`,
    barriers: {
      '3': { type: 'door', color: 'red' },
      '4': { type: 'door', color: 'blue' },
      '5': { type: 'window', mode: 'timer' },
    },
    markers: {
      j: { type: 'key', color: 'blue' },
      k: { type: 'key', color: 'red' },
    },
    humans: [{ path: 'abcde' }],
  },

  // ---------------------------------------------------------------------
  {
    name: 'Two Floors',
    hint: 'The stairs are watched — but mouse holes aren\'t. Step on a hole to pop out of its twin. The gold key is under the couch cushions somewhere downstairs.',
    grid: `
####################
#n--------#--------#
#--e----f-#--C-[]--#
#--[]-----#--------#
#---------7--------#
#--g------#-----h--#
###__##########__###
###__##########__###
#""""""""""""""""""#
#"i""""""""""""j"""#
#""""[[""""""[]""""#
#"""""""""v""""""""#
#"l"""""""""""""""p#
#""""]]""u"""""""""#
#"k"""""""""""""""q#
####################
#......,,..........#
#.....,,,...[].....#
#..m...,,......]...#
#.....,,...........#
#......,,...S......#
#..................#
####################`,
    barriers: { '7': { type: 'door', color: 'gold' } },
    markers: {
      u: { type: 'key', color: 'gold' },
      v: { type: 'cork' },
      m: { type: 'hole', pair: 'q' },
      q: { type: 'hole', pair: 'm' },
      p: { type: 'hole', pair: 'n' },
      n: { type: 'hole', pair: 'p' },
    },
    humans: [{ path: 'fhjklige' }],
  },

  // ---------------------------------------------------------------------
  {
    name: "Cat's Domain",
    hint: 'A cat guards the pantry — it hears nothing but sees all around itself. Grab the cheese crumb from the kitchen and drop it to lure the cat away.',
    grid: `
####################
#++++++++##________#
#+++[]+++##__C_____#
#++n+++++##___Q____#
#++++++++##________#
####==#####66#######
#=====~=====~======#
#========]=========#
####==########==####
#""""""""""""""""""#
#"a""""""""""b"""""#
#""[[["""""""""""""#
#""[[["""""j""]]"""#
#"d""""""""""c"""""#
#""""""""""""""""""#
########33##########
#......,,,.........#
#..[]..,,,....]....#
#......,,,.........#
#......,,,..S......#
#..................#
####################`,
    barriers: {
      '3': { type: 'window', mode: 'timer' },
      '6': { type: 'door', color: 'green' },
    },
    markers: {
      n: { type: 'crumb' },
      j: { type: 'key', color: 'green' },
      Q: { type: 'cat' },
    },
    humans: [{ path: 'abcd' }],
  },

  // ---------------------------------------------------------------------
  {
    name: 'Lights Out',
    hint: 'It\'s evening — dark rooms shrink the watcher\'s vision, but they flip the lights on wherever they go. Gnaw the lamp cord in the kitchen to keep it dark for good.',
    grid: `
####################
#--------#+++++++++#
#-e----f-#++C++[]++#
#--[]m---#++++++++i#
#--------#++++z++++#
####44#######55#####
#==================#
#=g======]=======h=#
####==########==####
#""""""""""""""""""#
#"a"""""""""""""b""#
#"""[[[""""""]]""""#
#"""[[[""""""""""""#
#"""""""j""""""""""#
#"d"""""""""""""c""#
#""""""""""""""""""#
########33##########
#......,,,.........#
#...[].,,,....]....#
#......,,,.........#
#......,,,...S.....#
#..................#
####################`,
    barriers: {
      '3': { type: 'window', mode: 'timer' },
      '4': { type: 'door', color: 'blue' },
      '5': { type: 'door', color: 'gold' },
    },
    markers: {
      j: { type: 'key', color: 'blue' },
      m: { type: 'key', color: 'gold' },
      z: { type: 'cord' },
    },
    humans: [{ path: 'abhifegdc' }],
    darkRooms: ['e', 'C', 'j'],
  },

  // ---------------------------------------------------------------------
  {
    name: 'Dinner Party',
    hint: 'Two hosts on the move tonight. The baseboards are full of mouse holes — use them as escape hatches. The dining room key is in the study.',
    grid: `
####################
#""""""""#+++++++++#
#"e""""f"#+g+++++h+#
#""[[]"""#++++[]+++#
#""""C"""#++++++++p#
###66#########==####
#=================n#
#=i=====]========j=#
####==########==####
#"""""""""""#___v__#
#"a"""""""b"#__u___#
#"""[[["""""=______#
#"""[[[""]]"#______#
#"d"""""""c"#__[]__#
#o""""""""""#____r_#
########33##########
#......,,,.........#
#..[]..,,,..m.]....#
#......,,,......q..#
#......,,,...S.....#
#..................#
####################`,
    barriers: {
      '3': { type: 'window', mode: 'timer' },
      '6': { type: 'door', color: 'gold' },
    },
    markers: {
      u: { type: 'key', color: 'gold' },
      v: { type: 'cork' },
      m: { type: 'hole', pair: 'n' },
      n: { type: 'hole', pair: 'm' },
      o: { type: 'hole', pair: 'p' },
      p: { type: 'hole', pair: 'o' },
      q: { type: 'hole', pair: 'r' },
      r: { type: 'hole', pair: 'q' },
    },
    humans: [{ path: 'efgh' }, { path: 'abcdij' }],
  },

  // ---------------------------------------------------------------------
  {
    name: 'The Pantry Vault',
    hint: 'The final heist: three keys, a creaky pantry, a cat on duty and a spool to climb the vault window. Good luck, little thief.',
    grid: `
####################
#________#~~~~~~~~~#
#___C____#~~~[]~~~~#
#________9~~~~Q~~~~#
#________#~~~~~~i~~#
##############88####
#=================n#
#=e======]=======f=#
####55####==###66###
#--------#==#______#
#--[]-u--#==#_[]___#
#---]----#==#w__y__#
#--------#=j#__v___#
##########==########
#""""""""""""""""""#
#"a"""""""""""""b""#
#""[[["""""""]]""""#
#"""""""k""""""""""#
#"d"""""""""""""c""#
#""""""""""""""""""#
########33##########
#......,,,.........#
#..[]..,,,..m.]....#
#......,,,.........#
#......,,,...S.....#
#..................#
####################`,
    barriers: {
      '3': { type: 'window', mode: 'timer' },
      '5': { type: 'door', color: 'red' },
      '6': { type: 'door', color: 'blue' },
      '8': { type: 'door', color: 'gold' },
      '9': { type: 'window', mode: 'spool' },
    },
    markers: {
      k: { type: 'key', color: 'red' },
      u: { type: 'key', color: 'blue' },
      w: { type: 'key', color: 'gold' },
      y: { type: 'spool' },
      v: { type: 'crumb' },
      m: { type: 'hole', pair: 'n' },
      n: { type: 'hole', pair: 'm' },
      Q: { type: 'cat' },
    },
    humans: [{ path: 'efi' }, { path: 'abjcd' }],
  },
];
