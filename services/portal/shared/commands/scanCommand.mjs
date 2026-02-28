export const createScanCommand = ({
                                      kavita,
                                  } = {}) => ({
    definition: {
        name: 'scan',
        description: 'List Kavita libraries available for onboarding.',
    },
    execute: async interaction => {
        await interaction.deferReply?.({ephemeral: true});

        if (!kavita?.fetchLibraries) {
            throw new Error('Kavita client is not configured.');
        }

        const libraries = await kavita.fetchLibraries();
        if (!libraries?.length) {
            await interaction.editReply?.({content: 'No Kavita libraries were found.'});
            return;
        }

        const summary = libraries
            .map(library => library?.name ?? library?.title ?? String(library?.id ?? 'unknown'))
            .join(', ');

        await interaction.editReply?.({content: `Kavita libraries: ${summary}`});
    },
});

export default createScanCommand;

