const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// CONFIGURATION
const CONFIG = {
    blogChannelId: process.env.BLOG_ID,
    projectsForumId: process.env.PROJECTS_ID,
    // Mapping des Tags Discord vers tes classes CSS/Icons
    tagMapping: {
        'Web': { icon: 'fas fa-globe', style: 'p-web' },
        'App': { icon: 'fas fa-mobile', style: 'p-app' },
        'IA':  { icon: 'fas fa-eye', style: 'p-focus' },
        '3D':  { icon: 'fas fa-cube', style: 'p-mol' },
        'Music': { icon: 'fa-brands fa-spotify', style: 'p-spot' }
    }
};

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- UTILITAIRES ---

// Télécharge l'image et retourne le chemin relatif pour le JSON
async function saveImage(url, messageId, filenamePrefix = '') {
    const ext = path.extname(url.split('?')[0]) || '.jpg';
    const filename = `${filenamePrefix}${messageId}${ext}`;
    const localPath = path.join(__dirname, '../img', filename);
    const publicPath = `img/${filename}`; // Chemin pour le site web

    if (fs.existsSync(localPath)) return publicPath; // Déjà téléchargée

    try {
        const response = await axios({ url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(publicPath));
            writer.on('error', reject);
        });
    } catch (e) {
        console.error("Erreur image:", e.message);
        return null;
    }
}

// Nettoie le nom pour faire un nom de fichier (ex: "Focus PCSI" -> "focuspcsi")
const sanitize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

// Parseur pour le header des projets (Desc: x, Link: y)
const parseMetadata = (content) => {
    const lines = content.split('\n');
    const data = {};
    lines.forEach(line => {
        const [key, ...val] = line.split(':');
        if (val.length) data[key.trim().toLowerCase()] = val.join(':').trim();
    });
    return data;
};

// --- LOGIQUE PRINCIPALE ---

client.once('ready', async () => {
    console.log(`Bot lancé sur ${client.user.tag}`);

    // 1. TRAITEMENT DU BLOG
    const blogChannel = await client.channels.fetch(CONFIG.blogChannelId);
    const blogMessages = await blogChannel.messages.fetch({ limit: 50 });
    const blogJson = [];

    for (const [id, msg] of blogMessages) {
        if (msg.author.bot || !msg.content.includes('|')) continue;

        // Syntaxe: Titre | Tag | Desc | Link
        const parts = msg.content.split('|').map(s => s.trim());
        if (parts.length < 3) continue;

        const entry = {
            title: parts[0],
            tag: parts[1],
            desc: parts[2],
            link: parts[3] || "#",
            date: msg.createdAt.toLocaleDateString('fr-FR'), // Format 13.10.2024
            image: null // Si tu veux gérer une image de fond pour le blog
        };
        blogJson.push(entry);
    }
    
    // LOGIQUE DE FUSION (BLOG)
    const blogPath = path.join(__dirname, '../blog.json');
    let finalBlog = blogJson;
    if (fs.existsSync(blogPath)) {
        try {
            const oldBlog = JSON.parse(fs.readFileSync(blogPath, 'utf8'));
            // On garde les anciens articles qui ne sont PAS dans la nouvelle liste (basé sur le titre)
            const newTitles = new Set(blogJson.map(b => b.title));
            const oldKept = oldBlog.filter(b => !newTitles.has(b.title));
            finalBlog = [...blogJson, ...oldKept];
        } catch (e) { console.error("Erreur lecture ancien blog:", e); }
    }
    fs.writeFileSync(blogPath, JSON.stringify(finalBlog, null, 4));
    
    console.log(`Blog généré : ${finalBlog.length} articles.`);


    // 2. TRAITEMENT DES PROJETS
    const forum = await client.channels.fetch(CONFIG.projectsForumId);
    // Récupère les threads actifs ET archivés
    const activeThreads = await forum.threads.fetchActive();
    const archivedThreads = await forum.threads.fetchArchived();
    const allThreads = [...activeThreads.threads.values(), ...archivedThreads.threads.values()];

    const projectsJson = [];

    for (const thread of allThreads) {
        // Ignorer si c'est juste une discussion random
        if (!thread.name) continue;

        // Récupérer le message initial (Starter Message)
        const starterMsg = await thread.fetchStarterMessage().catch(() => null);
        if (!starterMsg) continue;

        // Parser les métadonnées du premier message
        const meta = parseMetadata(starterMsg.content);
        
        // Gérer les tags/icônes via les tags du forum Discord
        let style = "p-default";
        let icon = "fas fa-code";
        
        if (thread.appliedTags && thread.appliedTags.length > 0) {
            // On cherche le nom du tag via son ID
            const tagObj = forum.availableTags.find(t => t.id === thread.appliedTags[0]);
            if (tagObj && CONFIG.tagMapping[tagObj.name]) {
                style = CONFIG.tagMapping[tagObj.name].style;
                icon = CONFIG.tagMapping[tagObj.name].icon;
            }
        }

        const detailFileName = `${sanitize(thread.name)}_detail.json`;

        // Construire l'objet project.json
        projectsJson.push({
            title: thread.name,
            version: meta['version'] || "V1.0",
            date: meta['date'] || thread.createdAt.toISOString().split('T')[0],
            desc: meta['desc'] || "Pas de description",
            link: meta['link'] || "#",
            icon: icon,
            style: style,
            btnText: meta['btntext'] || "VOIR",
            detailFile: detailFileName
        });

        // 3. GÉNÉRER LE FICHIER DETAIL DU PROJET
        // On récupère les messages du thread (historique)
        const updates = await thread.messages.fetch({ limit: 100 });
        const detailJson = [];

        for (const [msgId, msg] of updates) {
            if (msg.id === starterMsg.id) continue; // On ignore le message de présentation
            if (msg.author.bot) continue;

            // Gestion de l'image
            let imageMarkdown = "";
            if (msg.attachments.size > 0) {
                const imgUrl = await saveImage(msg.attachments.first().url, msg.id, 'update_');
                if (imgUrl) {
                    // On simule le format Markdown que tu avais dans ton exemple
                    imageMarkdown = `\n\n![Image](${imgUrl})`;
                }
            }

            // On essaie de trouver une version et une date dans le message ou on prend par défaut
            // Astuce: Tu peux écrire la première ligne comme "V5.0 - Stable"
            const lines = msg.content.split('\n');
            const versionTitle = lines[0]; // Première ligne = Version
            const restOfContent = lines.slice(1).join('\n'); // Le reste

            detailJson.push({
                date: msg.createdAt.toISOString().split('T')[0],
                version: versionTitle,
                content: restOfContent + imageMarkdown
            });
        }

        // LOGIQUE DE FUSION (DETAIL PROJET)
        const detailPath = path.join(__dirname, `../${detailFileName}`);
        let finalDetail = detailJson;
        if (fs.existsSync(detailPath)) {
            try {
                const oldDetails = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
                // On garde les anciennes mises à jour non présentes dans le nouveau fetch (basé sur la version)
                const newVersions = new Set(detailJson.map(d => d.version));
                const oldKeptDetails = oldDetails.filter(d => !newVersions.has(d.version));
                finalDetail = [...detailJson, ...oldKeptDetails];
            } catch (e) { console.error(`Erreur lecture detail ${detailFileName}:`, e); }
        }
        fs.writeFileSync(detailPath, JSON.stringify(finalDetail, null, 4));
    }

    // LOGIQUE DE FUSION (LISTE PROJETS)
    const projectsPath = path.join(__dirname, '../projects.json');
    let finalProjects = projectsJson;
    if (fs.existsSync(projectsPath)) {
        try {
            const oldProjects = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
            // On garde les anciens projets qui ne sont pas dans la nouvelle liste (basé sur le titre/nom du thread)
            const newProjectTitles = new Set(projectsJson.map(p => p.title));
            const oldKeptProjects = oldProjects.filter(p => !newProjectTitles.has(p.title));
            finalProjects = [...projectsJson, ...oldKeptProjects];
        } catch (e) { console.error("Erreur lecture anciens projets:", e); }
    }
    fs.writeFileSync(projectsPath, JSON.stringify(finalProjects, null, 4));
    
    console.log(`Projets générés : ${finalProjects.length} projets.`);

    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
