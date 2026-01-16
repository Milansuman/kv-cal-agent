import {Netra, NetraInstruments} from "netra-sdk";
import {randomUUID} from "node:crypto"

if (!process.env.NETRA_API_KEY) {
    throw new Error("NETRA_API_KEY is not set in environment variables");
}

export async function initializeNetraObservability(){
    await Netra.initAsync({
        appName: "netra-ts-test",
        headers: `x-api-key=${process.env.NETRA_API_KEY}`,
        traceContent: true,
        instruments: new Set([
            NetraInstruments.GROQ, 
            NetraInstruments.FETCH,
            NetraInstruments.LANGGRAPH
        ])
    });
    Netra.setTenantId("keyvalue");
    Netra.setUserId("random_user");
    Netra.setSessionId(randomUUID());
}
