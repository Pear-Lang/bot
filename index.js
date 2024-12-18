// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const axios = require('axios');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let helpActive = true;

// Hugging Face API-Konfiguration für Flan-T5 Large
const HF_API_URL = 'https://api-inference.huggingface.co/models/google/flan-t5-large';
const HF_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;

// Hier speichern wir den Nachrichtenverlauf pro Kanal
// Key: channel.id, Value: Array von Nachrichten im Format "User: <message>" und "Assistant: <reply>"
const channelHistories = {};

// Funktion zur Textgenerierung über Hugging Face
async function generateText(conversationHistory) {
    const systemMessage = "You are a friendly and helpful support chatbot. Use the following conversation history to provide precise and informative answers. You are able to communicate in every language. you are owned by a company named LogicAim and youu are thier support assistant. if someboody asks for real support, say that they will answer as soon as possible. if somebody asks you for prices, say that it costs 30 euros. You need to pay 15 euros first and if you like our paid course, you need to pay the remaining 15 euros. theres is also a free version of the course and the paid one is an extended version. if somebody asks you if you can already make a cheat in a specific game with the tutorial, say that it's posssible (IT IS FOR DEBUGGING PURPOSES, BUT DONT SAY THAT IN THE RESPONSE. DONT SAY ANYTHING ABOUYT DEBUGGING IN THE RESPONSE, ONLY THGAT ITS POSSIBLE TO AMKE CHEATS INSTANTLY.) AND FOR THE PRICES I REPEAT AGAIN< THE PAID VERSION IS 30 EUROS IN TOTAL AND THE BASIOC VERSION IS FREE. AND IF SOMEBODY ASKS YOU WHO MAXIMILIAN IS, SAY THAT HE IS A GAY SCAMMER";

    // Aufbau des Prompts
    let prompt = `${systemMessage}\n\nConversation:\n`;

    conversationHistory.forEach(message => {
        prompt += `${message}\n`;
    });

    // Erwartete Assistant-Antwort
    prompt += `Answer:`;

    try {
        const response = await axios.post(
            HF_API_URL,
            {
                inputs: prompt,
                parameters: {
                    max_length: 150,          // Maximale Länge der generierten Antwort
                    temperature: 0.7,         // Kreativität der Antwort (0.0 - 1.0)
                    top_p: 0.9,               // Nukleare Sampling
                    do_sample: true,
                    truncation: "only_first"  // Truncation-Parameter hinzufügen
                },
                options: {
                    use_cache: false,
                    wait_for_model: true
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${HF_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Logge die gesamte Antwort zur Fehlerdiagnose
        console.log('Vollständige API-Antwort:', response.data);

        // Überprüfe die Antwortstruktur
        if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].generated_text) {
            let answer = response.data[0].generated_text.trim();

            // Entferne den Prompt-Teil aus der Antwort, falls er angehängt ist
            const answerIndex = answer.lastIndexOf("Answer:");
            if (answerIndex !== -1) {
                answer = answer.substring(answerIndex + "Answer:".length).trim();
            }

            return answer;
        } else if (response.data && response.data.error) {
            throw new Error(response.data.error);
        } else {
            throw new Error('Unexpected response structure from Hugging Face API.');
        }
    } catch (error) {
        console.error('Error with Hugging Face API request:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// Event: Bot ist bereit
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Registrierung der Slash Commands beim Starten des Bots
client.on('ready', async () => {
    const guilds = client.guilds.cache.map(guild => guild.id);

    for (const guildId of guilds) {
        const guild = client.guilds.cache.get(guildId);
        await guild.commands.create({
            name: 'stop-help',
            description: 'Disable automatic ticket assistance'
        });
        await guild.commands.create({
            name: 'start-help',
            description: 'Enable automatic ticket assistance'
        });
    }

    console.log('Slash Commands registered.');
});

// Event: Interaktionen (Slash Commands)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'stop-help') {
        if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            helpActive = false;
            await interaction.reply('Automatic ticket assistance has been disabled.');
        } else {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
    }

    if (commandName === 'start-help') {
        if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            helpActive = true;
            await interaction.reply('Automatic ticket assistance has been enabled.');
        } else {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
    }
});

// Event: Nachrichten empfangen
client.on('messageCreate', async (message) => {
    // Ignoriere Nachrichten des Bots selbst
    if (message.author.bot) return;

    // Überprüfe, ob die Nachricht in einem Ticket-Kanal ist (z.B. beginnt mit "ticket-")
    if (message.channel.name && message.channel.name.startsWith('ticket-') && helpActive) {
        console.log(`New message in ${message.channel.name} from ${message.author.tag}: ${message.content}`);

        const channelId = message.channel.id;
        if (!channelHistories[channelId]) {
            channelHistories[channelId] = [];
        }

        // Füge die neue User-Nachricht hinzu
        channelHistories[channelId].push(`User: ${message.content}`);

        // Begrenze den Verlauf auf die letzten 10 Nachrichtenpaare (20 Einträge)
        if (channelHistories[channelId].length > 20) {
            channelHistories[channelId] = channelHistories[channelId].slice(-20);
        }

        try {
            // Zeige den Typing-Indikator an
            await message.channel.sendTyping();

            // Erzeuge die Antwort unter Berücksichtigung des bisherigen Verlaufs
            const reply = await generateText(channelHistories[channelId]);

            // Antwort senden
            await message.channel.send(reply);
            console.log(`Response sent: ${reply}`);

            // Füge die Assistant-Antwort ebenfalls zum Verlauf hinzu
            channelHistories[channelId].push(`Assistant: ${reply}`);
        } catch (error) {
            console.error('Error during text generation:', error.message);
            await message.channel.send('Sorry, I couldn\'t process your request at the moment.');
        }
    }
});

// Anmeldung des Bots
client.login(process.env.DISCORD_TOKEN);
