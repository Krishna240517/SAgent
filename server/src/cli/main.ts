#!/usr/bin/env bun


import chalk from "chalk";
import { Command } from "commander";
import figlet from "figlet";
import { login, logout, whoami } from "./commands/auth/auth";


const main = async() => {
    console.log(
        chalk.cyan(figlet.textSync("SAGENT",{font:"3D-ASCII", horizontalLayout: 'default'}))
    )
    

    console.log(chalk.yellow("A CLI Based Autonomous Agent\n"));


    const program = new Command("sage");

    program.version("0.0.1").description("SAGENT - Device Flow Authentication");

    program.addCommand(login);
    program.addCommand(logout);
    program.addCommand(whoami);

    program.action(() => {
        program.help();
    })

    program.parse();

}

main().catch((e) => {
    console.error(chalk.red("Error running SAgent CLI"),e);
    process.exit(1);
})