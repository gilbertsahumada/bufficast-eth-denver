import {
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
    type Action,
} from "@elizaos/core";
import { elizaLogger } from "@elizaos/core";
import { BlockchainService } from "./services/BlockchainService";
import { AudioService } from "./services/AudioService";
import { IPFSService } from "./services/IPFSService";
import { PodcastPrompt, PodcastMetadata } from "./interfaces/Podcast";
import { Anthropic } from '@anthropic-ai/sdk';
import { extractMessages } from "./utils/utils";

export const generatePodcastCL: Action = {
    name: "RANDOMIZE_SPEECH",
    similes: [],
    description: "Generate a podcast with VRF randomization and mint it as NFT",

    validate: async (_agent: IAgentRuntime, _memory: Memory, _state?: State) => {
        const messages = extractMessages(_memory.content.text);
        if (!messages) return false;

        if (_state) {
            _state.daily_messages = messages;
            return true;
        }
        return false;
    },

    handler: async (_agent: IAgentRuntime, _memory: Memory, _state?: State, _options?: any, _callback?: HandlerCallback) => {
        if (!_callback) throw new Error("Callback is required");
        const messages = extractMessages(_memory.content.text);

        const privateKey = process.env.EVM_PRIVATE_KEY;
        const contractAddress = process.env.CONTRACT_ADDRESS;
        const contractAddressFlow = process.env.CONTRACT_ADDRESS_FLOW;
        const apiKey = process.env.ANTHROPIC_API_KEY;
        const xiApiKey = process.env.ELEVENLABS_XI_API_KEY;
        const pinataJwt = process.env.PINATA_JWT;

        if (!privateKey || !contractAddress || !contractAddressFlow || !apiKey || !xiApiKey || !pinataJwt) {
            _callback({ text: "⚠️ Missing environment variables. Please check the configuration." });
            return false;
        }

        try {
            // Initialize services
            const blockchainService = new BlockchainService(
                privateKey,
                contractAddress,
                contractAddressFlow,
                false
            );

            const audioService = new AudioService(xiApiKey);
            const ipfsService = new IPFSService(pinataJwt);

            // Get Random parameters
            _callback({ text: "🎲 Requesting random parameters from Chainlink VRF ..." });
            const randomParams = await blockchainService.requestRandomParameters();


            // Generate text content
            _callback({ text: "✍️ Generating podcast content..." });
            const content = await generatePodcastContent(
                messages ? messages : ["Awesome messages!"],
                randomParams,
                process.env.ANTHROPIC_API_KEY!
            );

            // Generate audio
            _callback({ text: "🎙️ Converting text to speech..." });
            const audioPath = await audioService.generateAudio(content);

            // Upload to IPFS
            _callback({ text: "📤 Uploading to IPFS..." });
            const audioHash = await ipfsService.uploadAudioFile(audioPath);

            const metadata: PodcastMetadata = {
                name: "BuffiCast Podcast",
                description: `Podcast generated by BuffiCast with parameters: ${JSON.stringify(randomParams)}`,
                image: "https://ipfs.io/ipfs/bafkreifqzkq7tzppc22fa2f52sg2cruvomne2tp34yhdnx3ub2xw24b52m",
                external_url: `https://ipfs.io/ipfs/${audioHash}`
            };

            const metadataHash = await ipfsService.uploadMetadata(metadata);

            // Update token URI
            _callback({ text: "🔄 Updating NFT metadata for Tokenized Podcast ..." });
            await blockchainService.updateTokenURI(`https://ipfs.io/ipfs/${metadataHash}`);

            _callback({ text: "🔗 Minting NFT in Story ..." });
            /// Story INtegration
            const resp = await blockchainService.callStoryProtocol(audioHash, metadataHash);

            _callback({ text: `✨ Podcast secured on story protocol 🎉 Hash: ${resp.txHash} - Ip Id : ${resp.ipId}` });

            _callback({ text: "✨ Podcast generated and minted successfully! Check OpenSea to view your NFT 🎉: https://testnets.opensea.io/collection/podcast-chapter-1" });

            return true;

        } catch (error) {
            elizaLogger.error("Podcast Generation Error:", error);
            _callback({ text: "❌ An error occurred while generating the podcast." });
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: `use Chainlink to create me a speech "eth denver is awesome", "bufficast project is the best"` }
            },
            {
                user: "{{agentName}}",
                content: { text: "Let me do it for you!!", action: "RANDOMIZE_SPEECH" }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: { text: `Create me a podcast using Chainlink "ethereum is great", "avalanche is great", "solana sucks"` }
            },
            {
                user: "{{agentName}}",
                content: { text: "I'll start to create!", action: "RANDOMIZE_SPEECH" }
            }
        ]
    ]
};

async function generatePodcastContent(messages: string[], randomParams: any, apiKey: string): Promise<string> {
    const anthropic = new Anthropic({ apiKey });
    const prompt: PodcastPrompt = {
        instruction: "Generate a podcast script based on the day's messages. Create natural speech without formatting.",
        topic: "Ethereum Denver 2025 daily podcast",
        daily_messages: messages,
        random_parameters: randomParams,
        duration: "20 Seconds",
        language: "English"
    };

    const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        messages: [{ role: "user", content: JSON.stringify(prompt) }],
    });

    return response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('\n');
}



