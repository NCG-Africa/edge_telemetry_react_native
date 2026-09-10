// §3.3's four viewport keys, shaped once for both builds (#108).
//
// The *reads* are platform APIs and stay in `deviceInfo.native.ts` / `deviceInfo.web.ts`
// — RN's `Dimensions` + `PixelRatio`, the DOM's `innerWidth`/`innerHeight` +
// `devicePixelRatio`. The *derivation* is not, and a second copy of it is how the two
// builds drift: `screen_width_px` meaning physical pixels on one and CSS pixels on the
// other would make a single column mean two things.

/** §3.3 types all four never-null, so this returns all four or none of it is honest. */
export type ViewportKeys = {
    screen_density: number;
    screen_width_px: number;
    screen_height_px: number;
    orientation: Orientation;
};

/** §3.3's cardinality is 2. A square window reports `portrait`. */
export type Orientation = "portrait" | "landscape";

/**
 * @param cssWidth  logical width — dp on native, CSS px on web
 * @param cssHeight logical height, same units
 * @param density   the pixel ratio, so `cssWidth * density` is physical pixels on both
 */
export function viewportKeys(cssWidth: number, cssHeight: number, density: number): ViewportKeys {
    return {
        screen_density: density,
        screen_width_px: Math.round(cssWidth * density),
        screen_height_px: Math.round(cssHeight * density),
        // Derived from the two values the other keys already ship rather than from
        // `screen.orientation` / RN's orientation modules: no feature check, no new
        // dependency, and it cannot disagree with the dimensions on the same row.
        orientation: cssWidth > cssHeight ? "landscape" : "portrait",
    };
}
