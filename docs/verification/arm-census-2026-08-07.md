# Arm census — 2026-08-07

This census runs one classifier over the Biome-normalized source of the frozen vanilla control and the framework arm. Every normalized line has exactly one class; ambiguous lines fall to `game`.

Measured ratio: **425 / 473 = 89.9%** framework / vanilla normalized LOC.

## Totals

| Arm | Look | Game | Pattern | Plumbing | Normalized LOC | Raw LOC |
|---|---:|---:|---:|---:|---:|---:|
| vanilla | 104 | 257 | 13 | 99 | 473 | 410 |
| framework | 97 | 220 | 22 | 86 | 425 | 425 |

## Per-file reconciliation

Each class total must sum to the normalized total; the last column is the independent `count-loc.ts` total.

| Arm | File | Raw LOC | Look | Game | Pattern | Plumbing | Normalized LOC |
|---|---|---:|---:|---:|---:|---:|---:|
| vanilla | `examples/abyss-vanilla/src/main.js` | 410 | 104 | 257 | 13 | 99 | 473 |
| framework | `examples/abyss-framework/src/main.tsx` | 52 | 1 | 29 | 0 | 22 | 52 |
| framework | `examples/abyss-framework/src/render/lighting.ts` | 10 | 3 | 4 | 0 | 3 | 10 |
| framework | `examples/abyss-framework/src/render/postprocessing.ts` | 9 | 3 | 2 | 0 | 4 | 9 |
| framework | `examples/abyss-framework/src/scenes/Abyss.ts` | 354 | 90 | 185 | 22 | 57 | 354 |

## Classified line ranges

Ranges are inclusive and refer to the normalized source. The script retains the individual line rows used to produce these ranges.

### vanilla: `examples/abyss-vanilla/src/main.js`

- **look:** 12, 14-28, 64, 77, 79-80, 86-90, 93, 99-100, 102-105, 109-111, 113-115, 119-121, 123-126, 129-130, 132-135, 137-139, 142-145, 150-152, 154, 159-160, 165, 167, 171-173, 175-179, 184-190, 194, 200-201, 205, 208-212, 215-217, 223, 226, 231, 236, 238, 254-257, 354, 394
- **game:** 13, 29, 32, 35-36, 38-40, 42-43, 45-52, 56-60, 62, 65-67, 70, 72-73, 75, 78, 82, 84-85, 91-92, 94-95, 112, 116-117, 122, 127-128, 146-148, 155, 157-158, 161-162, 166, 168, 180-183, 191-193, 195, 199, 203, 206, 213-214, 218-220, 222, 224, 227-229, 232-233, 235, 237, 239, 241, 243-248, 250, 261-264, 266, 268-271, 275-292, 296-303, 305-313, 316, 318-322, 324-346, 350-351, 355-358, 360-364, 367-371, 374-393, 402, 404-416, 419-422, 424-440, 443-444, 447-465, 468, 471, 473
- **pattern:** 225, 240, 249, 314-315, 317, 352, 397-401, 423
- **plumbing:** 1-11, 30-31, 33-34, 37, 41, 44, 53-55, 61, 63, 68-69, 71, 74, 76, 81, 83, 96-98, 101, 106-108, 118, 131, 136, 140-141, 149, 153, 156, 163-164, 169-170, 174, 196-198, 202, 204, 207, 221, 230, 234, 242, 251-253, 258-260, 265, 267, 272-274, 293-295, 304, 323, 347-349, 353, 359, 365-366, 372-373, 395-396, 403, 417-418, 441-442, 445-446, 466-467, 469-470, 472

### framework: `examples/abyss-framework/src/main.tsx`

- **look:** 23
- **game:** 13-17, 19-20, 24-39, 41-43, 46, 51-52
- **pattern:** —
- **plumbing:** 1-12, 18, 21-22, 40, 44-45, 47-50

### framework: `examples/abyss-framework/src/render/lighting.ts`

- **look:** 3, 5-6
- **game:** 4, 7-8, 10
- **pattern:** —
- **plumbing:** 1-2, 9

### framework: `examples/abyss-framework/src/render/postprocessing.ts`

- **look:** 5-7
- **game:** 8-9
- **pattern:** —
- **plumbing:** 1-4

### framework: `examples/abyss-framework/src/scenes/Abyss.ts`

- **look:** 3-17, 57-59, 61, 68-71, 73-75, 77-79, 83-86, 88-89, 92-97, 100-101, 103-106, 109-110, 112-123, 128-131, 136-137, 140, 142, 144-146, 153-154, 157, 160-164, 167-169, 175, 178, 184, 187, 189, 268, 321
- **game:** 18, 25-36, 41, 47-49, 51-52, 54, 62, 76, 80-81, 87, 90-91, 98-99, 102, 107-108, 111, 124-126, 132, 134-135, 138-139, 141, 143, 147, 152, 156, 165-166, 170-171, 174, 176, 180-181, 183, 185-186, 188, 192-202, 204, 206, 208-217, 221-222, 225-227, 229-251, 254, 256, 258-263, 267, 269-272, 274, 278-283, 285-313, 315-320, 322-323, 330-331, 337-348, 350-354
- **pattern:** 148, 158, 172, 177, 179, 190-191, 203, 252-253, 255, 264, 325-329, 332-336
- **plumbing:** 1-2, 19-24, 37-40, 42-46, 50, 53, 55-56, 60, 63-67, 72, 82, 127, 133, 149-151, 155, 159, 173, 182, 205, 207, 218-220, 223-224, 228, 257, 265-266, 273, 275-277, 284, 314, 324, 349

