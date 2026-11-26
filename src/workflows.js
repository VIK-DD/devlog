const finished = 'completed';

function stage(update) {
  if (update.conclusion || update.status === finished) return 2;
  return update.status === 'in_progress' ? 1 : 0;
}

function accept(previous, next) {
  if (!previous) return true;
  const progress = stage(next) - stage(previous);
  return progress > 0 || (progress === 0 && next.updated >= previous.updated);
}

export function workflowUpdate(event, payload) {
  const job = event === 'workflow_job' ? payload.workflow_job : undefined;
  const run = event === 'workflow_run' ? payload.workflow_run : undefined;
  const target = job ?? run;
  const id = run?.id ?? job?.run_id;
  const repo = payload.repository;
  if (!target || !Number.isSafeInteger(id) || !(repo?.id || repo?.full_name)) return undefined;
  const actor = run?.actor ?? payload.sender;
  return {
    key: `${repo.id ?? repo.full_name}:${id}`,
    runId: id,
    attempt: target.run_attempt,
    repo: { name: repo.name, full_name: repo.full_name, html_url: repo.html_url },
    actor: actor && { login: actor.login, avatar_url: actor.avatar_url },
    jobId: job?.id,
    workflow: {
      name: run?.name ?? payload.workflow?.name ?? job?.workflow_name,
      event: run?.event,
      head_branch: target.head_branch,
      html_url: run?.html_url,
      started: Date.parse(run?.run_started_at) || 0,
    },
    update: {
      name: target.name,
      html_url: target.html_url,
      status: target.status ?? payload.action,
      conclusion: target.conclusion,
      updated: Date.parse(target.completed_at ?? target.updated_at ?? target.started_at ?? target.created_at) || 0,
    },
  };
}

export function mergeWorkflow(previous, event, timestamp) {
  const attempt = event.attempt ?? previous?.attempt ?? 1;
  if (previous && attempt < previous.attempt) return previous;
  const sameAttempt = previous?.attempt === attempt;
  const state = sameAttempt ? previous : {
    attempt, timestamp, repo: event.repo, actor: event.actor, workflow: {}, jobs: {},
  };
  const isJob = event.jobId != null;
  if (isJob && event.attempt == null && event.update.updated > 0 && event.update.updated < (state.workflow.started ?? 0)) {
    return previous ?? state;
  }

  const workflow = { ...state.workflow };
  for (const [key, value] of Object.entries(event.workflow)) {
    if (value && (!isJob || !workflow[key])) workflow[key] = value;
  }
  const next = { ...state, repo: event.repo, workflow };
  if (!isJob) {
    next.actor = event.actor ?? state.actor;
    if (accept(state.run, event.update)) next.run = event.update;
  } else if (accept(state.jobs[event.jobId], event.update)) {
    next.jobs = { ...state.jobs, [event.jobId]: event.update };
  }
  return next;
}

export function isActionsMetadata(event, payload) {
  return event === 'workflow_dispatch'
    || (event === 'check_run' && payload.check_run?.app?.slug === 'github-actions')
    || (event === 'check_suite' && payload.check_suite?.app?.slug === 'github-actions');
}
