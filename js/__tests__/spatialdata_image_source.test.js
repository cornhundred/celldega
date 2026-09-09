/**
 * The pure parts of the OME-Zarr image path.
 *
 * The loader itself is covered against a real store by integration/probes/viv_probe.mjs in
 * the workspace repo; what is pinned here is the arithmetic that would silently render the
 * wrong pyramid level or blow out the intensities.
 */

/* global require */

describe('OME-Zarr image source', () => {
  let zoomToLevel;
  let defaultWindow;
  let tileToRgba;

  beforeAll(() => {
    const fs = require('fs');
    const path = require('path');

    const source = fs
      .readFileSync(
        path.join(__dirname, '../spatialdata/image_source.js'),
        'utf8'
      )
      .replace(/^import \{[^}]*\} from '[^']+';$/gm, '')
      .replace(/^export const /gm, 'const ')
      .replace(/^export class /gm, 'class ');

    const code = `${source}\nmodule.exports = { zoomToLevel, defaultWindow, tileToRgba };`;
    const module = { exports: {} };
    new Function('module', 'exports', code)(module, module.exports);
    ({ zoomToLevel, defaultWindow, tileToRgba } = module.exports);
  });

  describe('zoom to resolution level', () => {
    test('deck.gl z maps onto viv resolution index', () => {
      // deck.gl counts down from 0 at full resolution; viv counts up from 0.
      expect(zoomToLevel(0, 5)).toBe(0);
      expect(zoomToLevel(-1, 5)).toBe(1);
      expect(zoomToLevel(-4, 5)).toBe(4);
    });

    test('clamps rather than reading past the pyramid', () => {
      // TileLayer is configured with minZoom -7 but the pyramid has 5 levels, so
      // out-of-range z arrives routinely and must not index undefined.
      expect(zoomToLevel(-7, 5)).toBe(4);
      expect(zoomToLevel(1, 5)).toBe(0);
      expect(zoomToLevel(-100, 1)).toBe(0);
    });
  });

  describe('intensity window', () => {
    test('defaults to the full dtype range, not a stretch', () => {
      // The viewer applies its own intensity slider afterwards; stretching here as well
      // double-applies and saturates the image.
      expect(defaultWindow(undefined, 'Uint16')).toEqual([0, 65535]);
      expect(defaultWindow({ label: 'DAPI' }, 'Uint16')).toEqual([0, 65535]);
      expect(defaultWindow(undefined, 'Uint8')).toEqual([0, 255]);
    });

    test('honours an omero window when the store provides one', () => {
      expect(
        defaultWindow({ window: { start: 100, end: 4000 } }, 'Uint16')
      ).toEqual([100, 4000]);
    });

    test('ignores a degenerate window', () => {
      expect(defaultWindow({ window: { start: 5, end: 5 } }, 'Uint16')).toEqual(
        [0, 65535]
      );
      expect(
        defaultWindow({ window: { start: 10, end: 2 } }, 'Uint16')
      ).toEqual([0, 65535]);
    });
  });

  describe('uint16 to RGBA', () => {
    test('maps the window onto 0-255 and keeps alpha opaque', () => {
      const data = Uint16Array.from([0, 32768, 65535, 100]);
      const rgba = tileToRgba(data, 2, 2, [0, 65535]);

      expect(rgba.length).toBe(2 * 2 * 4);
      expect(rgba[0]).toBe(0);
      expect(rgba[4]).toBe(128);
      expect(rgba[8]).toBe(255);
      // Grey, so the channel colour applied downstream is not tinted twice.
      expect(rgba[8]).toBe(rgba[9]);
      expect(rgba[9]).toBe(rgba[10]);
      // Alpha opaque everywhere.
      expect([rgba[3], rgba[7], rgba[11], rgba[15]]).toEqual([
        255, 255, 255, 255,
      ]);
    });

    test('clamps values outside the window instead of wrapping', () => {
      const data = Uint16Array.from([0, 5000]);
      const rgba = tileToRgba(data, 2, 1, [1000, 2000]);
      expect(rgba[0]).toBe(0);
      expect(rgba[4]).toBe(255);
    });

    test('a zero-width window does not divide by zero', () => {
      const data = Uint16Array.from([7]);
      const rgba = tileToRgba(data, 1, 1, [7, 7]);
      expect(Number.isFinite(rgba[0])).toBe(true);
    });
  });
});
