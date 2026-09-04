// Generates an AR.js "pattern" marker (.patt) plus a printable/scannable
// full marker image (white margin + black square frame + inner icon), from
// assets/network-marker-source.png. Reimplements the exact algorithm from
// AR.js's own marker-training tool (three.js/examples/marker-training/
// threex-arpatternfile.js: encodeImage() and buildFullMarker()) in Node
// with sharp, since that tool only runs interactively in a browser.
//
// Rotation note: encodeImage() stores 4 canvas-rotated (0/-90/-180/-270deg)
// copies of the 16x16 downsample so AR.js can match the marker at any
// viewing angle. We reproduce that with plain 90-degree array rotations
// (numpy-rot90-style) instead of canvas rotate() - the exact rotation
// direction/chirality doesn't matter for matching, only that the 4 stored
// blocks are true 90-degree-consistent rotations of one another, which
// this guarantees.
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "../assets/network-marker-source.png");
const OUT_DIR = path.join(__dirname, "../assets");
const PATT_OUT = path.join(OUT_DIR, "network-marker.patt");
const FULL_MARKER_OUT = path.join(OUT_DIR, "network-marker-printable.png");

const PATT_SIZE = 16;
const FULL_SIZE = 1000;
const PATTERN_RATIO = 0.5;
const BORDER_COLOR = "#000000";

function rot90(grid, size, channels) {
    // grid: flat array indexed [y*size*channels + x*channels + c]
    // returns new grid rotated 90 degrees
    const out = new Array(grid.length);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // (x, y) -> (y, size-1-x)
            const nx = y;
            const ny = size - 1 - x;
            for (let c = 0; c < channels; c++) {
                out[(ny * size + nx) * channels + c] = grid[(y * size + x) * channels + c];
            }
        }
    }
    return out;
}

function buildPattFileString(grid, size, channels) {
    let rotations = [grid];
    for (let i = 0; i < 3; i++) {
        rotations.push(rot90(rotations[rotations.length - 1], size, channels));
    }

    let out = "";
    rotations.forEach((rGrid, idx) => {
        if (idx !== 0) out += "\n";
        // BGR order (matches AR.js's own encoder)
        const channelOrder = channels >= 3 ? [2, 1, 0] : [0];
        channelOrder.forEach((channelOffset) => {
            for (let y = 0; y < size; y++) {
                let row = "";
                for (let x = 0; x < size; x++) {
                    const value = rGrid[(y * size + x) * channels + channelOffset];
                    if (x !== 0) row += " ";
                    row += String(value).padStart(3);
                }
                out += row + "\n";
            }
        });
    });
    return out;
}

async function main() {
    // 1. .patt file - straight 16x16 non-uniform-stretch downsample of the
    // source icon (matches canvas drawImage(image, 0,0,16,16) semantics).
    const { data, info } = await sharp(SRC)
        .resize(PATT_SIZE, PATT_SIZE, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const pattString = buildPattFileString(Array.from(data), PATT_SIZE, info.channels);
    fs.writeFileSync(PATT_OUT, pattString, "utf8");
    console.log("Wrote", PATT_OUT, `(${info.channels} channels)`);

    // 2. Printable full marker: white margin -> black square frame ->
    // white inner area -> icon, following AR.js's buildFullMarker() math.
    const whiteMargin = 0.1;
    const blackMargin = (1 - 2 * whiteMargin) * ((1 - PATTERN_RATIO) / 2);
    const innerMargin = whiteMargin + blackMargin;

    const svg = `
        <svg width="${FULL_SIZE}" height="${FULL_SIZE}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="${FULL_SIZE}" height="${FULL_SIZE}" fill="white"/>
            <rect x="${whiteMargin * FULL_SIZE}" y="${whiteMargin * FULL_SIZE}"
                  width="${(1 - 2 * whiteMargin) * FULL_SIZE}" height="${(1 - 2 * whiteMargin) * FULL_SIZE}"
                  fill="${BORDER_COLOR}"/>
            <rect x="${innerMargin * FULL_SIZE}" y="${innerMargin * FULL_SIZE}"
                  width="${(1 - 2 * innerMargin) * FULL_SIZE}" height="${(1 - 2 * innerMargin) * FULL_SIZE}"
                  fill="white"/>
        </svg>
    `;

    const innerSize = Math.round((1 - 2 * innerMargin) * FULL_SIZE);
    const innerIcon = await sharp(SRC).resize(innerSize, innerSize, { fit: "fill" }).toBuffer();

    await sharp(Buffer.from(svg))
        .composite([{ input: innerIcon, left: Math.round(innerMargin * FULL_SIZE), top: Math.round(innerMargin * FULL_SIZE) }])
        .png()
        .toFile(FULL_MARKER_OUT);

    console.log("Wrote", FULL_MARKER_OUT);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
