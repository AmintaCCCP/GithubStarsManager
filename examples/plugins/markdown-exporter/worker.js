'use strict';

let context;

function toMarkdown(repository) {
  const description = repository.description ? ` — ${repository.description}` : '';
  return `- [${repository.full_name}](${repository.html_url})${description}`;
}

module.exports = {
  async activate(pluginContext) {
    context = pluginContext;
    const activations = Number(await context.storage.get('activations')) || 0;
    await context.storage.set('activations', activations + 1);
    await context.log.info('Markdown exporter activated');
  },

  async deactivate() {
    await context?.log.info('Markdown exporter deactivated');
  },

  runAction({ repositories }) {
    return {
      type: 'text',
      content: repositories.map(toMarkdown).join('\n'),
      suggestedAction: 'copy',
    };
  },

  runProcessor({ repositories }) {
    return {
      repositories: repositories.map((repository) => ({
        id: repository.id,
        summary: `${repository.full_name}: ${repository.stargazers_count} stars`,
        tags: repository.pushed_at ? ['has-push-history'] : [],
      })),
    };
  },

  runExporter({ repositories }) {
    return {
      content: `# GitHub Stars\n\n${repositories.map(toMarkdown).join('\n')}\n`,
      fileName: 'github-stars.md',
    };
  },
};
