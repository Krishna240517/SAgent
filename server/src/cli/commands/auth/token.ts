import fs  from "fs/promises";
import { TOKEN_FILE, CONFIG_DIR } from "./auth";
import chalk from "chalk";
import boxen from "boxen";
import { createAuthClient } from "better-auth/client";
import { logger } from "better-auth"
import yoctoSpinner from "yocto-spinner";


type StoredTokenFile = {
    access_token: string;
    refresh_token: string;
    token_type: string;
    scope?: string;
    expires_at: string | null;
    created_at: string;
}

type StoredToken = {
    access_token: string;
    refresh_token: string;
    token_type?: string;
    scope?: string;
    expires_in?: number;
}


type BetterAuthDeviceClient = ReturnType<typeof createAuthClient> & {
    device: {
        code: (...args: any[]) => Promise<any>;
        token: (...args: any[]) => Promise<any>;
    };
};

export async function getStoredToken(): Promise<StoredTokenFile | null> {
    try {
        const data = await fs.readFile(TOKEN_FILE,'utf-8');
        const token = JSON.parse(data);
        return token;
    } catch (e) {
        return null;
    }
};



export async function storeToken(token: StoredToken) {
    try {
        await fs.mkdir(CONFIG_DIR,{recursive: true});
        const tokenData = {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            token_type: token.token_type || "Bearer",
            scope: token.scope,
            expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
            createdAt: new Date().toISOString()
        };

        await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2),'utf-8');

        return true;
    } catch (e: unknown) {
        if(e instanceof Error) {
            console.error(chalk.red("Failed to Store token:"), e.message);
        }
    }
}

export async function clearStoredToken() {
    try {
        await fs.unlink(TOKEN_FILE);
        return true;
    } catch(e) {
        return false;
    }
};

export async function isTokenExpired() {
    const token = await getStoredToken();
    if(!token || !token.expires_at) return true;

    const expiresAt = new Date(token.expires_at);
    const now = new Date();

    return expiresAt.getTime() - now.getTime() < 1 * 60 * 1000;
}

export async function requireAuth() {
    const token = await getStoredToken();

    if(!token) {
        console.log(chalk.red(`❌ Not Authenticated. Please run the below command`));
        console.log(boxen('sage --login',{borderColor:"green",borderStyle:"single"}))
        process.exit(1);
    }

    if(await isTokenExpired()) {
        console.log(chalk.yellow("⚠️ Your session has expired. Please login again."));
        console.log(boxen('sage --login',{borderColor:"green",borderStyle:"single"}));
        process.exit(1);
    }
    return token;
};

export async function pollForToken(authClient: BetterAuthDeviceClient, deviceCode: string, clientId: string, initialInterval: number) {
    let pollingInterval = initialInterval;

    const spinner = yoctoSpinner({text:"",color:"cyan"});

    let dots = 0;

    return new Promise<any>((resolve, reject) => {
        const poll = async () => {
            dots = (dots + 1) % 4;
            spinner.text = chalk.gray(
                `Polling for authorization${".".repeat(dots)}${" ".repeat(3 - dots)}`
            );
            if (!spinner.isSpinning) spinner.start();

            try {
                const { data, error } = await authClient.device.token({
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    device_code: deviceCode,
                    client_id: clientId,
                    fetchOptions: {
                        headers: {
                            "user-agent": `SAGENT CLI`,
                        },
                    },
                });

                if (data?.access_token) {
                    console.log(
                        chalk.bold.yellow(`Your access token: ${data.access_token}`)
                    );
                    spinner.stop();
                    resolve(data);
                    return;
                } else if (error) {
                    switch (error.error) {
                        case "authorization_pending":
                            break;
                        case "slow_down":
                            pollingInterval += 5;
                            break;
                        case "access_denied":
                            spinner.stop();
                            logger.error("Access was denied by the user");
                            process.exit(1);
                        case "expired_token":
                            spinner.stop();
                            logger.error("The device code has expired. Please try again.");
                            process.exit(1);
                        default:
                            spinner.stop();
                            logger.error(`Error: ${error.error_description}`);
                            process.exit(1);
                    }
                }
            } catch (err: unknown) {
                spinner.stop();

                if (err instanceof Error) {
                    logger.error(`Network error: ${err.message}`);
                } else {
                    logger.error("Unknown network error");
                }

                process.exit(1);
            }

            setTimeout(poll, pollingInterval * 1000);
        };

        setTimeout(poll, pollingInterval * 1000);
    });
}

