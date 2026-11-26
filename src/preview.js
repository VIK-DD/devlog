import { discordMessage, makeEmbeds } from './embeds.js';

const repoUrl = 'https://github.com/acme/atlas';
const timestamp = new Date().toISOString();
const common = {
  repository: { name: 'Atlas', full_name: 'acme/atlas', html_url: repoUrl },
  sender: { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4' },
};
const push = {
  ...common,
  ref: 'refs/heads/main',
  compare: repoUrl + '/compare/a0b1c2d...d3e4f5a',
  commits: [
    { id: 'a0b1c2d', message: 'Validate settings on startup', url: repoUrl + '/commit/a0b1c2d' },
    { id: 'd3e4f5a', message: 'Refresh the activity dashboard', url: repoUrl + '/commit/d3e4f5a' },
  ],
};
const workflow = {
  ...common,
  action: 'completed',
  workflow_job: {
    name: 'Build and deploy',
    workflow_name: 'Deploy UI',
    head_branch: 'main',
    conclusion: 'success',
    html_url: repoUrl + '/actions/runs/123/job/456',
  },
};
const samples = [
  ...makeEmbeds('push', push, timestamp),
  ...makeEmbeds('workflow_job', workflow, timestamp),
  ...makeEmbeds('workflow_job', { ...workflow, workflow_job: { ...workflow.workflow_job, conclusion: 'failure' } }, timestamp),
];
console.log(JSON.stringify(samples.map((embed, index) => discordMessage(embed, 'preview-' + index)), null, 2));
