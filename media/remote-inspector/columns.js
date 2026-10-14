/* global acquireVsCodeApi */
(() => {
	const vscode = acquireVsCodeApi();
	const kind = document.body.dataset.kind;
	const tree = document.getElementById('tree');
	const search = document.getElementById('search');
	const saved = vscode.getState() || {};
	const expanded = new Set(saved.expanded || []);
	const requested = new Set();
	let initialized = saved.initialized || false;
	let rootIds = saved.rootIds || '';
	let snapshot = { rows: [], connected: false };
	let focusedId;
	let filterTimer;
	let visibleRows = [];
	search.value = kind === 'properties' ? saved.filter || '' : '';
	const send = (type, id) => vscode.postMessage({ type, id });
	const persist = () => vscode.setState({ expanded: [...expanded], initialized, rootIds, filter: search.value, scroll: tree.scrollTop });
	function element(tag, className, text) {
		const el = document.createElement(tag);
		if (className) el.className = className;
		if (text !== undefined) el.textContent = text;
		return el;
	}
	function action(label, title, callback) {
		const button = element('button', 'action', label);
		button.title = title;
		button.setAttribute('aria-label', title);
		button.addEventListener('click', event => { event.stopPropagation(); callback(); });
		return button;
	}
	function render() {
		const scroll = tree.scrollTop;
		const focused = tree.contains(document.activeElement);
		const query = search.value.trim().toLowerCase();
		const matches = new Set();
		const visit = row => {
			let match = `${row.label}\n${row.description}`.toLowerCase().includes(query);
			for (const child of row.children) match = visit(child) || match;
			if (match) matches.add(row.id);
			return match;
		};
		if (kind === 'properties' && query) snapshot.rows.forEach(visit);
		if (!initialized && snapshot.rows.length) {
			for (const row of snapshot.rows) expanded.add(row.id);
			initialized = true;
		}
		const fragment = document.createDocumentFragment();
		visibleRows = [];
		function append(row, depth, parent) {
			if (kind === 'properties' && query && !matches.has(row.id)) return;
			const open = query ? true : expanded.has(row.id);
			const selected = kind === 'scene' && row.id === snapshot.selectedId;
			const el = element('div', `row${selected ? ' selected' : ''}${row.hidden ? ' hidden' : ''}${depth === 0 ? ' root' : ''}`);
			el.dataset.id = row.id;
			el.setAttribute('role', 'treeitem');
			el.setAttribute('aria-level', String(depth + 1));
			el.setAttribute('aria-selected', String(selected));
			if (row.loadState === 'loading') el.setAttribute('aria-busy', 'true');
			el.tabIndex = row.id === focusedId ? 0 : -1;
			el.title = [row.path, row.label, row.description, row.hidden ? 'Hidden in the running scene' : ''].filter(Boolean).join('\n');
			const indent = element('span', 'indent');
			for (let i = 0; i < depth; i++) indent.append(element('span'));
			el.append(indent);
			const twisty = element('button', 'twisty', row.children.length ? open ? '⌄' : '›' : '');
			twisty.tabIndex = -1;
			twisty.setAttribute('aria-label', open ? 'Collapse branch' : 'Expand branch');
			if (row.children.length) {
				el.setAttribute('aria-expanded', String(open));
				twisty.addEventListener('click', event => { event.stopPropagation(); toggle(row); });
			} else twisty.disabled = true;
			el.append(twisty);
			if (row.icon) {
				const icon = element('img', 'icon');
				icon.src = row.icon; icon.alt = '';
				icon.addEventListener('error', () => { icon.hidden = true; });
				el.append(icon);
			}
			el.append(element('span', 'label', row.label), element('span', 'description', row.description + (row.hidden ? ' · hidden' : '')));
			if (kind === 'scene') el.append(action('⧉', 'Copy node path', () => send('copyPath', row.id)));
			if (row.editable) el.append(action('✎', 'Edit value', () => send('edit', row.id)));
			if (row.inspectable) el.append(action('↗', 'Inspect object', () => send('inspect', row.id)));
			el.addEventListener('click', () => {
				focusedId = row.id; el.focus();
				if (kind === 'scene') send('select', row.id);
				else toggle(row);
			});
			el.addEventListener('focus', () => { focusedId = row.id; });
			visibleRows.push({ row, el, parent });
			fragment.append(el);
			if (open) row.children.forEach(child => append(child, depth + 1, row));
			// Restore explicitly expanded objects after refreshing the selected node.
			if (open && expanded.has(row.id) && row.loadState === 'unloaded' && !requested.has(row.id)) {
				requested.add(row.id);
				send('expand', row.id);
			}
		}
		snapshot.rows.forEach(row => append(row, 0));
		tree.replaceChildren(fragment);
		if (focused) visibleRows.find(item => item.row.id === focusedId)?.el.focus({ preventScroll: true });
		tree.scrollTop = scroll;
		document.body.classList.toggle('is-empty', visibleRows.length === 0);
		document.getElementById('empty').textContent = query ? `No ${kind === 'scene' ? 'nodes' : 'properties'} match "${search.value}".` : kind === 'scene' ? snapshot.connected ? 'Waiting for the running scene tree…' : 'Start a Godot debug session to explore the running scene.' : snapshot.connected ? 'Select a node in the Scene Tree column to inspect its properties.' : 'Start a Godot debug session, then select a node.';
		document.getElementById('count').textContent = kind === 'scene' ? `${count(snapshot.rows)} nodes` : snapshot.rows[0]?.description || '';
		document.getElementById('selection').textContent = snapshot.selectedPath || '';
		document.getElementById('selection').title = snapshot.selectedPath || '';
		const highlight = document.getElementById('highlight');
		highlight.hidden = kind !== 'scene' || !snapshot.canHighlight;
		highlight.setAttribute('aria-pressed', String(snapshot.highlightEnabled));
		document.getElementById('status').textContent = snapshot.connected ? kind === 'scene' ? 'Live scene · Click a node to inspect' : 'Selected node · Edit values with the pencil' : 'No active Godot debug session';
		persist();
	}
	function count(rows) { return rows.reduce((total, row) => total + 1 + count(row.children), 0); }
	function toggle(row) {
		if (!row.children.length) return;
		if (expanded.has(row.id)) expanded.delete(row.id);
		else {
			expanded.add(row.id);
			if (row.loadState === 'error') send('expand', row.id);
		}
		focusedId = row.id;
		render();
	}
	tree.addEventListener('keydown', event => {
		const index = visibleRows.findIndex(item => item.row.id === focusedId);
		const current = visibleRows[index];
		let target;
		if (event.key === 'ArrowDown') target = visibleRows[Math.min(index + 1, visibleRows.length - 1)];
		else if (event.key === 'ArrowUp') target = visibleRows[Math.max(0, index - 1)];
		else if (event.key === 'Home') target = visibleRows[0];
		else if (event.key === 'End') target = visibleRows[visibleRows.length - 1];
		else if (event.key === 'ArrowRight' && current) {
			if (current.row.children.length && !expanded.has(current.row.id)) toggle(current.row);
			else target = visibleRows[index + 1];
		} else if (event.key === 'ArrowLeft' && current) {
			if (expanded.has(current.row.id)) toggle(current.row);
			else target = visibleRows.find(item => item.row.id === current.parent?.id);
		} else if (event.key === 'Enter' && current) {
			if (kind === 'scene') send('select', current.row.id);
			else if (current.row.inspectable) send('inspect', current.row.id);
			else toggle(current.row);
		} else if (event.key === 'F2' && current?.row.editable) send('edit', current.row.id);
		else return;
		event.preventDefault();
		if (target) { focusedId = target.row.id; target.el.focus(); }
	});
	search.addEventListener('input', () => {
		if (kind === 'properties') render();
		else {
			clearTimeout(filterTimer);
			filterTimer = setTimeout(() => vscode.postMessage({ type: 'filter', query: search.value }), 120);
		}
	});
	document.getElementById('refresh').addEventListener('click', () => send('refresh'));
	document.getElementById('collapse').addEventListener('click', () => { expanded.clear(); render(); });
	document.getElementById('highlight').addEventListener('click', () => vscode.postMessage({ type: 'highlight', enabled: !snapshot.highlightEnabled }));
	tree.addEventListener('scroll', persist, { passive: true });
	window.addEventListener('message', event => {
		if (event.data?.type !== 'snapshot' || event.data.kind !== kind) return;
		if (event.data.revision !== snapshot.revision) requested.clear();
		snapshot = event.data;
		const nextRootIds = snapshot.rows.map(row => row.id).join('|');
		if (nextRootIds !== rootIds) {
			for (const row of snapshot.rows) expanded.add(row.id);
			rootIds = nextRootIds;
		}
		if (kind === 'scene' && document.activeElement !== search) search.value = snapshot.filter || '';
		render();
	});
	render();
	tree.scrollTop = saved.scroll || 0;
	send('ready');
})();
