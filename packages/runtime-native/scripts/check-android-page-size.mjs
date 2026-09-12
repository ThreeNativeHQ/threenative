#!/usr/bin/env node

/**
 * Whether an Android environment's observed page size qualifies as 16 KB.
 *
 * The fact this exists to protect: "we ran on Android 15" is not "we ran with 16 KB pages". An
 * ordinary emulator image reports 4096 and passes every other check in this repository, so a lane
 * that never reads `getconf PAGE_SIZE` will report a green 16 KB qualification it never observed.
 *
 * Fail closed, like the rest of the gates here: a missing observation is a failure, not a skip.
 * An unreadable, empty, non-integer or zero value is a failure. 4096 is a failure *for a 16 KB
 * claim* and a perfectly good ordinary result, which is why the expected size is an argument
 * rather than a constant — the 4 KB lane uses the same function to assert it got 4 KB.
 */

/** Android's 16 KB page size, in bytes. */
export const ANDROID_16KB_PAGE_SIZE = 16384;
/** The ordinary page size every other Android image reports. */
export const ANDROID_4KB_PAGE_SIZE = 4096;

export class AndroidPageSizeError extends Error {}

/** Parse what `adb shell getconf PAGE_SIZE` printed. Throws on anything that is not a page size. */
export function parseObservedPageSize(observed) {
	if (observed === undefined || observed === null) {
		throw new AndroidPageSizeError(
			'TN_ANDROID_PAGE_SIZE_MISSING: no page size was observed. A 16 KB qualification without `getconf PAGE_SIZE` is a claim, not a measurement.',
		);
	}
	if (typeof observed !== 'string') {
		throw new AndroidPageSizeError(
			`TN_ANDROID_PAGE_SIZE_MALFORMED: expected the text adb printed, received ${typeof observed}.`,
		);
	}
	// adb hands back CRLF from the device shell; a trailing \r turns Number() into NaN.
	const text = observed.replace(/\r/gu, '').trim();
	if (text.length === 0) {
		throw new AndroidPageSizeError(
			'TN_ANDROID_PAGE_SIZE_EMPTY: the page size observation is empty. An offline device and a 16 KB device must not read the same.',
		);
	}
	if (!/^\d+$/u.test(text)) {
		throw new AndroidPageSizeError(
			`TN_ANDROID_PAGE_SIZE_MALFORMED: '${text}' is not a page size in bytes.`,
		);
	}
	const size = Number(text);
	if (!Number.isSafeInteger(size) || size <= 0) {
		throw new AndroidPageSizeError(`TN_ANDROID_PAGE_SIZE_MALFORMED: '${text}' is not a page size.`);
	}
	return size;
}

/**
 * Assert the observed page size is the one this lane claims to be qualifying.
 * Returns the observed size so a caller can record the number it actually saw.
 */
export function assertObservedPageSize(observed, expected = ANDROID_16KB_PAGE_SIZE) {
	if (expected !== ANDROID_16KB_PAGE_SIZE && expected !== ANDROID_4KB_PAGE_SIZE) {
		throw new AndroidPageSizeError(
			`TN_ANDROID_PAGE_SIZE_EXPECTATION: ${expected} is not a page size this repository qualifies.`,
		);
	}
	const size = parseObservedPageSize(observed);
	if (size !== expected) {
		throw new AndroidPageSizeError(
			`TN_ANDROID_PAGE_SIZE_MISMATCH: this lane qualifies ${expected}-byte pages and the device reported ${size}. ` +
				(size === ANDROID_4KB_PAGE_SIZE && expected === ANDROID_16KB_PAGE_SIZE
					? 'That is an ordinary 4 KB image; a 16 KB qualification needs a 16 KB system image (system-images;android-36;google_apis_ps16k;x86_64).'
					: 'Select the image this lane is meant to run.'),
		);
	}
	return size;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
	const [, , file, expectedArgument] = process.argv;
	const { readFileSync } = await import('node:fs');
	if (file === undefined) {
		console.error('usage: check-android-page-size.mjs <observation file> [expected bytes]');
		process.exit(2);
	}
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		console.error(
			`TN_ANDROID_PAGE_SIZE_MISSING: ${file} was never written, so the device was never asked.`,
		);
		process.exit(1);
	}
	try {
		const expected = expectedArgument === undefined ? ANDROID_16KB_PAGE_SIZE : Number(expectedArgument);
		console.log(`observed page size: ${assertObservedPageSize(text, expected)} bytes`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
