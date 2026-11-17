#!/usr/bin/env node

import chalk from "chalk";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { login, logout, whoami } from "./commands/auth/auth.js";
import { backupLegacyPGlite } from "./storage/legacy.js";
import { chat } from "./chat/commands.js";
import { sync } from "./sync/commands.js";


const main = async() => {
    const program = new Command("sagent");

    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    program.version(version).description("SAgent CLI");

    program.addCommand(login);
    program.addCommand(logout);
    program.addCommand(whoami);
    program.addCommand(chat);
    program.addCommand(sync);
    program.command("backup-legacy").description("Back up and verify existing local PGlite files").action(() => {
        const result = backupLegacyPGlite();
        console.log(result.backupPath ? `Verified ${result.filesVerified} files in ${result.backupPath}` : "No legacy PGlite directories found.");
    });

    program.action(() => program.help());
    await program.parseAsync(process.argv);

}

main().catch((e) => {
    console.error(chalk.red("Error running SAgent CLI"),e);
    process.exit(1);
})
