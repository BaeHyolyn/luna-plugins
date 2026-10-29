import { Client, StatusDisplayType, type ClientOptions, type SetActivity } from "@xhayper/discord-rpc";
import { asyncDebounce } from "@inrixia/helpers";
import { getAvailablePipes } from "./getAvailablePipes.native";

const CLIENT_ID = "1563775440320204900";

let rpcClient: Client | null = null;
let wantedPipeId = -1;

const disconnect = async () => {
	const client = rpcClient;
	rpcClient = null;
	await client?.destroy().catch(() => {});
};

// Pipes are only scanned when (re)connecting, not on every activity update.
const connect = asyncDebounce(async (preferredPipeId: number) => {
	const pipes = await getAvailablePipes();
	const targetPipe = pipes.length > 0 && !pipes.includes(preferredPipeId) ? pipes[0] : preferredPipeId;

	const options: ClientOptions = { clientId: CLIENT_ID };
	if (targetPipe >= 0) options.pipeId = targetPipe;

	const client = new Client(options);
	client.once("disconnected", () => {
		if (rpcClient === client) rpcClient = null;
	});
	await client.connect();

	rpcClient = client;
	wantedPipeId = preferredPipeId;
	return client;
});

const getClient = async (preferredPipeId: number) => {
	if (rpcClient && preferredPipeId !== wantedPipeId) await disconnect();
	if (rpcClient?.transport.isConnected && rpcClient.user) return rpcClient;
	await disconnect();
	return connect(preferredPipeId);
};

export const setActivity = async (activity?: SetActivity, preferredPipeId = -1) => {
	try {
		const client = await getClient(preferredPipeId);
		if (!client?.user) return;
		if (!activity) return await client.user.clearActivity();
		return await client.user.setActivity(activity);
	} catch (err) {
		// Drop the client so the next update reconnects (Discord restarted, etc.)
		await disconnect();
		throw err;
	}
};

export const cleanupRPC = () => disconnect();

export const StatusDisplayTypeEnum = () => ({
	Name: StatusDisplayType.NAME,
	State: StatusDisplayType.STATE,
	Details: StatusDisplayType.DETAILS,
});
