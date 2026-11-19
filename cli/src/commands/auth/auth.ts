import { intro, confirm, isCancel, cancel, outro } from "@clack/prompts";
import open from "open";
import { logger } from "better-auth";
import chalk from "chalk";
import { clearStoredToken, getStoredToken, isTokenExpired, requireAuth, storeToken, TOKEN_FILE, CONFIG_DIR } from "./session.js";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import yoctoSpinner from "yocto-spinner";
import { pollForToken } from "./session.js";
import { Command } from "commander";
import { API_URL } from "../../config.js";
import { openGlobalStore } from "../../storage/index.js";
import { bindSyncAccount } from "../../sync/client.js";


const CLIENT_ID = process.env.SAGENT_CLIENT_ID || "sagent-cli";



export async function loginAction(opts: { serverUrl?: string; clientId?: string })  {
    const serverUrl = opts.serverUrl || API_URL;
    const clientId = opts.clientId || CLIENT_ID;

    intro(chalk.bold("Perfroming SAGENT login action"));


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
            client_id: clientId,
            scope:"openid profile email"
        });

        spinner.stop();

        if(error || !data) {
            logger.error(`Failed to request device authorization: ${error?.error_description || "Unknown error"}`);
            
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
            const urlToOpen = verification_uri_complete || verification_uri;
            await open(urlToOpen);
        }

        
        console.log(chalk.gray(`Waiting for Device Authorization (expires in ${Math.floor(expires_in / 60)} minutes)`));
        
        const token = await pollForToken(authClient,device_code, clientId,interval);
        const { data: session, error: sessionError } = await authClient.getSession({
            fetchOptions: {
                headers: {
                    authorization: `Bearer ${token.access_token}`
                }
            }
        });

        if (sessionError || !session?.user) throw new Error("Could not validate the new session.");
        const db = openGlobalStore();
        try { bindSyncAccount(db, session.user.id); }
        finally { db.close(); }
        const saved = await storeToken(token);
        if (!saved) throw new Error("Could not save the authentication token.");

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

export async function logoutAction(opts: { serverUrl?: string }) {
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

    if(isCancel(shouldLogout) || !shouldLogout) {
        cancel("Logout Cancelled");
        process.exit(0);
    }

    try {
        const authClient = createAuthClient({ baseURL: opts.serverUrl || API_URL });
        const { error } = await authClient.signOut({ fetchOptions: {
            headers: { authorization: `Bearer ${token.access_token}` }
        } });
        if (error && error.status !== 401) throw new Error(error.message || "Session revocation failed.");
    } catch (error) {
        console.error(chalk.red("Could not revoke the session; the local token was kept."), error);
        return;
    }
    const cleared = await clearStoredToken();
    
    if(cleared) {  
        outro(chalk.green("Successfully Logged Out"));
    } else {
        console.log(chalk.yellow(" Could not clear token file."));
        console.log(chalk.bgYellow.white(`You can manually delete the token file in this path:\n ${CONFIG_DIR}`));
    }   
};

export async function whoamiAction(opts: { serverUrl?: string }) {
    const token = await requireAuth();
    if(!token?.access_token) {
        console.log("No access token found. Please login.");
        process.exit(1);
    }

    const authClient = createAuthClient({ baseURL: opts.serverUrl || API_URL });
    const { data: session, error } = await authClient.getSession({
        fetchOptions: {
            headers: {
                authorization: `Bearer ${token.access_token}`
            }
        }
    });
    const user = session?.user;

    if(error || !user) {
        console.log(chalk.red("User not found."));
        process.exit(1);
    }
    await storeToken({ ...token, expires_at: new Date(session.session.expiresAt).toISOString() });
    console.log(chalk.bold.greenBright(`👤 User: ${user.name} \n📧 Email: ${user.email}\n👤 ID: ${user.id}`));
}

export const login = new Command("login").description("Login to SAgent").option("--server-url <url>","The SAgent Server URL", API_URL).option("--client-id <id>","The device client id", CLIENT_ID).action(loginAction);
export const logout = new Command("logout").description("Revoke and clear stored credentials").option("--server-url <url>", "The SAgent Server URL", API_URL).action(logoutAction);
export const whoami = new Command("whoami") .description("Show current authenticated user").option("--server-url <url>", "The SAgent Server URL", API_URL).action(whoamiAction);
