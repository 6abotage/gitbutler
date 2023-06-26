import { invoke } from '$lib/ipc';
import { Branch } from './types';
import { stores } from '$lib';
import { writable, type Loadable, Value } from 'svelte-loadable-store';
import { plainToInstance } from 'class-transformer';
import type { Readable } from '@square/svelte-store';

const cache: Record<string, Readable<Loadable<Branch[]>>> = {};

export function getStore(projectId: string) {
	if (projectId in cache) return cache[projectId];

	// Subscribe to sessions,  grab the last one and subscribe to deltas on it.
	// When a delta comes in, refresh the list of virtual branches.
	const store = writable(list(projectId), (set) => {
		const unsubscribeSessions = stores.sessions({ projectId }).subscribe((sessions) => {
			if (sessions.isLoading) return;
			if (Value.isError(sessions.value)) return;
			const lastSession = sessions.value.at(0);
			if (!lastSession) return;
			const unsubscribeDeltas = stores
				.deltas({ projectId, sessionId: lastSession.id })
				.subscribe(() => {
					list(projectId).then((newBranches) => {
						set(sort(newBranches));
					});
					return () => {
						Promise.resolve(unsubscribeDeltas).then((unsubscribe) => unsubscribe());
					};
				});
			return () => {
				Promise.resolve(unsubscribeSessions).then((unsubscribe) => unsubscribe());
			};
		});
	});
	cache[projectId] = store;

	return {
		subscribe: store.subscribe,
		refresh: () =>
			list(projectId).then((newBranches) =>
				store.set({ isLoading: false, value: sort(newBranches) })
			)
	};
}
function sort(branches: Branch[]): Branch[] {
	for (const branch of branches) {
		for (const file of branch.files) {
			file.hunks.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
		}
	}
	return branches;
}

async function list(projectId: string): Promise<Branch[]> {
	return plainToInstance(
		Array<Branch>,
		invoke<Array<Branch>>('list_virtual_branches', { projectId })
	);
}

export function sortBranchHunks(branches: Branch[]): Branch[] {
	for (const branch of branches) {
		for (const file of branch.files) {
			file.hunks.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
		}
	}
	return branches;
}

async function listVirtualBranches(params: { projectId: string }) {
	return invoke<Array<Branch>>('list_virtual_branches', params);
}

export function getVBranchesOnBackendChange(
	projectId: string,
	callback: (newBranches: Array<Branch>) => void
) {
	stores.sessions({ projectId }).subscribe((sessions) => {
		if (sessions.isLoading) return;
		if (Value.isError(sessions.value)) return;
		const lastSession = sessions.value.at(0);
		if (!lastSession) return;
		return stores
			.deltas({ projectId, sessionId: lastSession.id })
			.subscribe(() =>
				listVirtualBranches({ projectId }).then((newBranches) =>
					callback(plainToInstance(Branch, newBranches))
				)
			);
	});
}