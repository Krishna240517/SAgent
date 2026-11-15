import path from "node:path";
import os from "os";
import { env } from "../../../config/env";
import { z } from "zod";
import { intro, confirm, isCancel, cancel, outro } from "@clack/prompts";
import open from "open";
import { logger } from "better-auth";
import chalk from "chalk";
import { clearStoredToken, getStoredToken, isTokenExpired, requireAuth, storeToken, } from "./token";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import yoctoSpinner from "yocto-spinner";
import { pollForToken } from "./token";
import { prisma } from "../../../config/db";
import { Command } from "commander";


const URL = `http://localhost:${env.BACKEND_PORT}`;
const CLIENT_ID = `${env.GITHUB_CLIENT_ID}`;
export const CONFIG_DIR = path.join(os.homedir(),".SAGENT");
export const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");



export async function loginAction(opts: unknown)  {
    const options = z.object({
        serverUrl: z.string().optional(),
        clientId: z.string().optional()
    }).parse(opts);

    const serverUrl = options.serverUrl || URL;
    const clientId = options.clientId || CLIENT_ID;

    intro(chalk.bold("Perfroming SAGENT login action"));

    if(!clientId) {
        logger.error("CLIENT_ID is not set.env folder");
        console.log(chalk.red("\n❌ Please set Github_CLIENT_ID in your .env file"))
        process.exit(1);
    }
    

    const existingToken = await getStoredToken();
    const expired = await isTokenExpired();


    if(existingToken && !expired) {
         const shouldReauth = await confirm({
            message: "You're already logged in. Do you want to log in again?",
            initialValue: false,
        });

        if(isCancel(shouldReauth) || !shouldReauth) {
            cancel('Login Cancelled');
            process.exit(0)
        }
    }


    const authClient = createAuthClient({
        baseURL: serverUrl,
        plugins: [deviceAuthorizationClient()]
    });


    const spinner = yoctoSpinner({text:"Requesting Device Authorization......"});
    spinner.start();

    try {
        const { data, error } = await authClient.device.code({
            client_id: CLIENT_ID,
            scope:"openid profile email"
        });

        spinner.stop();

        if(error || !data) {
            logger.error(`Failed to request device authorization: ${error?.error_description || error?.message || "Unknown error"}`);
            
            if(error?.status === 404) {
                console.log(chalk.red("\n❌ Device Authorization endpoint not found."));
                console.log(chalk.yellow("   Make sure your auth server is running."));
            } else if (error?.status === 400) {
                console.log(
                    chalk.red("\n❌ Bad request - check your CLIENT_ID configuration.")
                );
            }

            process.exit(1);
        }

        const { device_code, user_code, verification_uri, verification_uri_complete, interval = 5, expires_in } = data;
        
        console.log();
        console.log(chalk.cyan("Device Authorization required..."));
        console.log();
        console.log(`Please visit ${chalk.underline.blue(verification_uri|| verification_uri_complete)}`);
        console.log(`Enter Code: ${chalk.bold.green(user_code)}`);
        console.log();


        const shouldOpen = await confirm({
            message: "Open Browser Automatically ?",
            initialValue: true
        });

        if(!isCancel(shouldOpen) && shouldOpen) {
            const urlToOpen = verification_uri || verification_uri_complete;
            await open(urlToOpen);
        }

        
        console.log(chalk.gray(`Waiting for Device Authorization (expires in ${Math.floor(expires_in / 60)} minutes)`));
        
        const token = await pollForToken(authClient,device_code, clientId,interval);
        if (token) {
            const saved = await storeToken(token);
            if (!saved) {
                console.log(chalk.yellow("\n⚠️  Warning: Could not save authentication token."));
                console.log(chalk.yellow("   You may need to login again on next use."));
            }
        }
        
        const { data: session } = await authClient.getSession({
            fetchOptions: {
                headers: {
                    authorization: `Bearer ${token.access_token}`
                }
            }
        });

        outro(chalk.green(`Login Successfull! Welcome ${session?.user?.name || session?.user?.email || "User"}`));

        console.log(chalk.gray(`\n Token saved to: ${TOKEN_FILE}`));
        console.log(
            chalk.gray("   You can now use AI commands without logging in again.\n")
        );
    } catch (e: any) {
        spinner.stop();
        console.error(chalk.red("\nLogin Failed"), e.message);
        process.exit(1);
    }
}

export async function logoutAction() {
    intro(chalk("Performing Logout..."));
    const token = await getStoredToken();
    if(!token) {
        console.log(chalk.red("Already Logged Out"));
        process.exit(0);
    }

    const shouldLogout = await confirm({
        message:"Do you really wanna Logout ?",
        initialValue: false
    });

    if(isCancel(shouldLogout) && !shouldLogout) {
        cancel("Logout Cancelled");
        process.exit(0);
    }

    const cleared = await clearStoredToken();
    
    if(cleared) {  
        outro(chalk.green("Successfully Logged Out"));
    } else {
        console.log(chalk.yellow(" Could not clear token file."));
        console.log(chalk.bgYellow.white(`You can manually delete the token file in this path:\n ${CONFIG_DIR}`));
    }   
};

export async function whoamiAction(opts) {
    const token = await requireAuth();
    if(!token?.access_token) {
        console.log("No access token found. Please login.");
        process.exit(1);
    }

    const user = await prisma.user.findFirst({
        where: {
            sessions: {
                some: {
                    token: token.access_token
                }
            }
        }, select: {
            id: true,
            name: true,
            email: true
        }
    });

    if(!user) {
        console.log(chalk.red("User not found."));
        process.exit(1);
    }
    console.log(chalk.bold.greenBright(`👤 User: ${user.name} \n📧 Email: ${user.email}\n👤 ID: ${user.id}`));
}

export const login = new Command("login").description("Login to SAgent").option("--server-url <url>","The SAgent Server URL", URL).option("--client-id","The OAUTH client id", CLIENT_ID).action(loginAction);
export const logout = new Command("logout").description("Logout and clear stored credentials").action(logoutAction);
export const whoami = new Command("whoami") .description("Show current authenticated user").option("--server-url <url>", "The SAgent Server URL", URL).action(whoamiAction);