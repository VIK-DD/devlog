import { discordMessage, makeEmbeds, workflowEmbed } from './embeds.js';
import { mergeWorkflow, workflowUpdate } from './workflows.js';

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
const workflowRun = {
  ...common,
  action: 'completed',
  workflow_run: {
    id: 123,
    name: 'Deploy UI',
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    html_url: repoUrl + '/actions/runs/123',
  },
};
const workflowJob = {
  ...common,
  action: 'completed',
  workflow_job: {
    id: 456,
    run_id: 123,
    name: 'Build and deploy',
    workflow_name: 'Deploy UI',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    html_url: repoUrl + '/actions/runs/123/job/456',
  },
};
const completed = mergeWorkflow(undefined, workflowUpdate('workflow_run', workflowRun), timestamp);
const withJob = mergeWorkflow(completed, workflowUpdate('workflow_job', workflowJob), timestamp);
const failed = { ...workflowRun, workflow_run: { ...workflowRun.workflow_run, conclusion: 'failure' } };
const failedJob = { ...workflowJob, workflow_job: { ...workflowJob.workflow_job, conclusion: 'failure' } };
const failedState = mergeWorkflow(undefined, workflowUpdate('workflow_run', failed), timestamp);
const samples = [
  ...makeEmbeds('push', push, timestamp),
  workflowEmbed(withJob, 123),
  workflowEmbed(mergeWorkflow(failedState, workflowUpdate('workflow_job', failedJob), timestamp), 123),
];
console.log(JSON.stringify(samples.map((embed, index) => discordMessage(embed, 'preview-' + index)), null, 2));
