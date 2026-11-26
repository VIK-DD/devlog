const colors = {
  push: 0x5865f2,
  success: 0x57f287,
  failure: 0xed4245,
  pending: 0xfee75c,
  neutral: 0x8b949e,
  merged: 0xa371f7,
};

const states = {
  success: ['✅', 'Finished successfully', colors.success],
  failure: ['❌', 'Failed', colors.failure],
  error: ['❌', 'Error', colors.failure],
  startup_failure: ['❌', 'Failed to start', colors.failure],
  timed_out: ['⏱️', 'Timed out', colors.failure],
  cancelled: ['⚪', 'Cancelled', colors.neutral],
  skipped: ['⏭️', 'Skipped', colors.neutral],
  neutral: ['⚪', 'Finished', colors.neutral],
  inactive: ['⚪', 'Inactive', colors.neutral],
  queued: ['🕒', 'Queued', colors.pending],
  waiting: ['🕒', 'Waiting', colors.pending],
  requested: ['🕒', 'Requested', colors.pending],
  pending: ['🕒', 'Pending', colors.pending],
  in_progress: ['🟡', 'In progress', colors.pending],
  completed: ['⚪', 'Completed', colors.neutral],
};

const eventNames = {
  pull_request: 'Pull request',
  pull_request_review: 'Pull request review',
  pull_request_review_comment: 'Review comment',
  pull_request_review_thread: 'Review thread',
  issues: 'Issue',
  issue_comment: 'Comment',
  release: 'Release',
  repository: 'Repository',
  discussion: 'Discussion',
  discussion_comment: 'Discussion comment',
  fork: 'Fork',
  star: 'Star',
  workflow_dispatch: 'Manual workflow run',
  check_run: 'Check run',
  check_suite: 'Check suite',
  status: 'Commit status',
  package: 'Package',
  registry_package: 'Package',
};

function text(value, limit = 180) {
  const line = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim();
  if (line.length <= limit) return line;
  return line.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

function markdown(value, limit) {
  return text(value, limit).replace(/[\\`*_{}\[\]()<>~|]/g, '\\$&');
}

function githubUrl(value, hosts = ['github.com']) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && hosts.includes(url.host) && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    return undefined;
  }
}

function link(label, url) {
  return url ? '[' + label + '](<' + url + '>)' : label;
}

function words(value) {
  const label = text(value, 60).replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function branch(ref) {
  return text(String(ref ?? '').replace(/^refs\/(heads|tags)\//, ''), 120);
}

function baseEmbed(payload, timestamp) {
  const { repository, sender } = payload;
  const actor = payload.workflow_run?.actor ?? sender;
  return {
    author: {
      name: text(repository.name || repository.full_name, 64),
      url: githubUrl(repository.html_url),
      icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    },
    footer: {
      text: 'by ' + text(actor?.login ?? payload.pusher?.name ?? 'GitHub', 100),
      icon_url: githubUrl(actor?.avatar_url, ['avatars.githubusercontent.com', 'github.com']),
    },
    timestamp,
  };
}

function pushEmbeds(payload, base, incomplete) {
  const ref = branch(payload.ref) || 'ref';
  const refType = payload.ref?.startsWith('refs/tags/') ? 'Tag' : 'Branch';
  const url = githubUrl(payload.compare) ?? base.author.url;
  const commits = payload.commits ?? [];
  const count = commits.length;
  const notes = [];
  if (payload.created) notes.push(refType + ' created');
  if (payload.forced) notes.push('Force push');
  if (incomplete) notes.push('Partial list. Open the comparison for details.');
  const color = payload.deleted ? colors.failure : colors.push;
  const title = payload.deleted
    ? refType + ' deleted · ' + ref
    : (count === 1 ? '1 commit' : count + ' commits') + ' on ' + ref;

  const pages = [];
  let lines = notes;
  let entries = 0;
  for (const commit of commits) {
    const subject = markdown(String(commit.message ?? '').split(/\r?\n/, 1)[0], 96)
      || ('Commit ' + text(commit.id?.slice(0, 7))).trimEnd();
    const commitUrl = githubUrl(commit.url);
    const line = '• ' + link(subject, commitUrl && commitUrl.length <= 300 ? commitUrl : undefined);
    if (entries === 10 || lines.join('\n').length + line.length + 1 > 3900) {
      pages.push(lines.join('\n'));
      lines = [];
      entries = 0;
    }
    lines.push(line);
    entries++;
  }
  pages.push(lines.join('\n'));

  return pages.map((description, index) => ({
    ...base,
    color,
    title: pages.length > 1 ? title + ' · ' + (index + 1) + '/' + pages.length : title,
    url,
    description: description || undefined,
  }));
}

function statusEmbed(payload, base) {
  const job = payload.workflow_job;
  const run = payload.workflow_run;
  const deployment = payload.deployment;
  const target = job ?? run ?? deployment;
  const state = job?.conclusion ?? run?.conclusion ?? payload.deployment_status?.state
    ?? job?.status ?? run?.status ?? (deployment ? 'requested' : payload.action);
  const [icon, status, color] = states[state] ?? ['⚪', words(state), colors.neutral];
  const kind = deployment ? 'Deploy' : (job ? 'Job' : 'Workflow');
  const ref = branch(target?.head_branch ?? deployment?.ref);
  const context = text(job?.workflow_name ?? deployment?.environment ?? words(run?.event), 80);
  const name = job?.name ?? run?.name ?? (deployment ? 'Deploy · ' + (deployment.environment || 'GitHub') : kind);
  const deployUrl = deployment && base.author.url ? base.author.url + '/deployments' : undefined;
  const summary = status + (ref ? ' on **' + markdown(ref, 68) + '**' : '');
  const contextSeparator = summary.length + context.length > 62 ? '\n' : ' · ';
  return {
    ...base,
    color,
    title: icon + ' ' + text(name, 76),
    url: githubUrl(target?.html_url) ?? deployUrl ?? base.author.url,
    description: context ? summary + contextSeparator + markdown(context) : summary,
  };
}

export function actorMatches(event, payload, login) {
  if (!login) return true;
  const matches = (user) => user?.toLowerCase() === login;
  if ([payload.sender?.login, payload.workflow_run?.actor?.login, payload.workflow_run?.triggering_actor?.login,
    payload.deployment?.creator?.login, payload.workflow_job?.actor?.login,
    payload.pusher?.name].some(matches)) return true;
  return event === 'push' && (payload.commits ?? []).some((commit) =>
    matches(commit.author?.username) || matches(commit.committer?.username));
}

export function makeEmbeds(event, payload, timestamp, incomplete = false) {
  if (!payload.repository?.name && !payload.repository?.full_name) return [];
  const base = baseEmbed(payload, timestamp);
  if (event === 'push') return pushEmbeds(payload, base, incomplete);
  if (['workflow_run', 'workflow_job', 'deployment', 'deployment_status'].includes(event)) {
    return [statusEmbed(payload, base)];
  }

  if (event === 'create' || event === 'delete') {
    const isTag = payload.ref_type === 'tag';
    const created = event === 'create';
    return [{
      ...base,
      title: (isTag ? 'Tag' : 'Branch') + (created ? ' created · ' : ' deleted · ') + branch(payload.ref),
      url: base.author.url,
      color: created ? colors.success : colors.failure,
    }];
  }

  const subject = payload.pull_request ?? payload.issue ?? payload.release ?? payload.discussion
    ?? payload.forkee ?? payload.check_run ?? payload.package ?? payload.registry_package;
  const description = markdown(subject?.title ?? subject?.name ?? subject?.tag_name, 120);
  const number = Number.isSafeInteger(subject?.number) ? ' #' + subject.number : '';
  const merged = event === 'pull_request' && payload.action === 'closed' && payload.pull_request?.merged;
  const action = merged ? 'Merged' : words(payload.action ?? payload.state);
  return [{
    ...base,
    color: merged ? colors.merged : colors.neutral,
    title: (eventNames[event] ?? words(event)) + number + (action ? ' · ' + action : ''),
    description: description || undefined,
    url: githubUrl(payload.comment?.html_url ?? payload.review?.html_url)
      ?? githubUrl(subject?.html_url) ?? base.author.url,
  }];
}

export function discordMessage(embed, nonce) {
  return { embeds: [embed], allowed_mentions: { parse: [] }, nonce, enforce_nonce: true };
}
