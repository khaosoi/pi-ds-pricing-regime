#!/usr/bin/env node
/**
 * Install/uninstall the DeepSeek peak/off-peak extension for pi.
 *
 *   node scripts/install.mjs link     # symlink into ~/.pi/agent/extensions/ (default)
 *   node scripts/install.mjs unlink   # remove the symlink
 *
 * The extension's source of truth lives in this project (src/). The global
 * extensions dir gets a symlink so pi auto-discovers it and the file is still
 * tracked here. If a real file already occupies the target path, it is backed
 * up to <name>.bak before being replaced.
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const FILE_NAME = "deepseek-peak-offpeak.ts";
const source = join(projectRoot, "src", FILE_NAME);
const targetDir = join(homedir(), ".pi", "agent", "extensions");
const target = join(targetDir, FILE_NAME);

const command = process.argv[2] ?? "link";

function fail(msg) {
	console.error(`error: ${msg}`);
	process.exit(1);
}

function isSymlink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function link() {
	if (!existsSync(source)) fail(`source not found: ${source}`);
	if (!existsSync(targetDir)) fail(`pi extensions dir not found: ${targetDir}`);

	if (isSymlink(target)) {
		const resolved = readlinkSync(target);
		if (resolved === source) {
			console.log(`already linked: ${target} -> ${source}`);
			return;
		}
		console.log(`replacing symlink ${target} (was -> ${resolved})`);
		unlinkSync(target);
	} else if (existsSync(target)) {
		const backup = `${target}.bak`;
		console.log(`backing up existing file to ${backup}`);
		renameSync(target, backup);
	}

	symlinkSync(source, target);
	console.log(`linked ${target} -> ${source}`);
	console.log("run /reload inside pi to activate (or restart pi).");
}

function unlink() {
	if (!isSymlink(target)) {
		console.log(`no symlink at ${target} — nothing to do.`);
		return;
	}
	unlinkSync(target);
	console.log(`removed ${target}`);
	const backup = `${target}.bak`;
	if (existsSync(backup)) {
		console.log(`note: a backup exists at ${backup} — restore it with:\n  mv ${backup} ${target}`);
	}
}

if (command === "link") link();
else if (command === "unlink") unlink();
else fail(`unknown command "${command}" (expected link or unlink)`);
