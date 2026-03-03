export const createDingCommand = () => ({
    definition: {
        name: 'ding',
        description: 'Check if the Noona Portal bot is awake.',
    },
    execute: async interaction => {
        await interaction.reply?.({content: 'Dong! Portal is online.', ephemeral: true});
    },
});

export default createDingCommand;

