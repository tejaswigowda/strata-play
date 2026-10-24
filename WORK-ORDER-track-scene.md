# Work order: scene changes for `track.glb`

**For:** the scene author.
**From:** the implementing agent (`outputs/track.js`, lap race).
**Status:** one required change and four optional ones. The logic already works around all of them, so nothing blocks on this.

## 1. Required: rename the `Trigger` material

**Problem:** strata-play selectors also match material names and the ancestors of matching meshes. The gate material is named `Trigger`, so `.trigger` matches 32 nodes instead of 31. The extra one is `#Gameplay`.

**Change:** rename the material `Trigger` to a name that is not also a class, for example `M_GateVolume`. Keep the node classes (`trigger`, `checkpoint`, `start-line`) as they are.

**Why:** the harness no longer gives `#Gameplay` a body, but any other selector or tool that treats a material name as a class still sees the collision.

**Check after re-export:**

- `$S('.trigger').count` is 31.
- `$S('#Gameplay').toArray()[0].userData.physicsBody` is `undefined`.

## 2. Optional: avoid the same collision elsewhere

The same effect applies to these material names: `Paint`, `Asphalt`, `Grass`, `Sea`, `Concrete`. For example, `.sea` also matches the groups above the `Sea` mesh.

**Change:** prefix material names with `M_` (`M_Paint`, `M_Asphalt` and so on) on the next rebuild. Don't rename the node classes, which are `road`, `drivable`, `offroad` and the like.

## 3. Optional: gate visibility

The 8 gate volumes use a translucent blue material (opacity 0.14), so they show as faint glass walls across the road.

**Decision for the scene author:**

- **(a)** Keep them as they are.
- **(b)** Make the material fully transparent (or hide the meshes). The logic uses the geometry, not visibility, so it still works.

Tell the implementing agent which you pick. If you choose (b), the start-line gantry model already shows where the line is.

## 4. Optional: stop item boxes and boost pads getting sensor bodies

`.item-box` and `.boost-pad` nodes carry the `trigger` class, so the harness builds cannon sensor bodies for them. The logic doesn't use those bodies.

**Change:** if you don't need them elsewhere, drop `trigger` from those two classes. Keep `pickup`, `item-box` and `boost-pad`.

## 5. Optional: make the labels self-describing

- **Gate direction:** `track.js` assumes each gate's local +Z is the driving direction, and checks it against the chord to the neighbouring gates. All 8 matched, so nothing was flipped. Add a note or a node extra such as `"forward": "+z"` so the next author knows the convention.
- **Logic pointer:** add `"strata:logic": "outputs/track.js"` to the scene root extras, so the URL works without relying on the filename. Today it only works because of the `track.glb` → `track.js` basename default.
- **Racing line for bots:** the bots read the road mesh as a ribbon, with vertex pairs (left, right) per sample and index pattern 0,1,2,1,3,2. That breaks if the road is rebuilt differently, and then the bots silently don't spawn. A labelled polyline along the road (for example `#RacingLine`, one point per ~5 m, in driving order) would be sturdier. If you add it, tell the implementing agent and the bots will switch to reading it.

## 6. After you re-export

Tell the implementing agent when it's done. They will check the counts in section 1, run the same lap scenarios against the new GLB, and report anything that changed.

## 7. Out of scope

- Editing the GLB (that stays with the scene author).
- Gameplay tuning, which stays in `track.js`: top speed, lap count, item and boost timings.
