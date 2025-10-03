<script lang="ts">
  import type { ModificationRules } from '../api/routes';

  export let value: ModificationRules = {};
  export let label: string = 'Headers';
  export let showHelp: boolean = true;

  // 确保基本结构
  $: value = {
    add: value?.add || {},
    remove: value?.remove || [],
    default: value?.default || {}
  };

  // Add section
  let addEntries: Array<{ key: string; value: string }> = [];
  $: {
    addEntries = Object.entries(value.add || {}).map(([key, val]) => ({
      key,
      value: String(val)
    }));
  }

  function addHeader() {
    addEntries = [...addEntries, { key: '', value: '' }];
  }

  function removeAddEntry(index: number) {
    addEntries = addEntries.filter((_, i) => i !== index);
    updateAddValue();
  }

  function updateAddValue() {
    const add: Record<string, string> = {};
    addEntries
      .filter(e => e.key.trim())
      .forEach(e => {
        add[e.key] = e.value;
      });
    value.add = add;
  }

  // Remove section
  let removeValue = '';
  $: removeValue = (value.remove || []).join(', ');

  function updateRemoveValue() {
    value.remove = removeValue
      .split(',')
      .map(s => s.trim())
      .filter(s => s);
  }

  // Default section
  let defaultEntries: Array<{ key: string; value: string }> = [];
  $: {
    defaultEntries = Object.entries(value.default || {}).map(([key, val]) => ({
      key,
      value: String(val)
    }));
  }

  function addDefaultHeader() {
    defaultEntries = [...defaultEntries, { key: '', value: '' }];
  }

  function removeDefaultEntry(index: number) {
    defaultEntries = defaultEntries.filter((_, i) => i !== index);
    updateDefaultValue();
  }

  function updateDefaultValue() {
    const def: Record<string, string> = {};
    defaultEntries
      .filter(e => e.key.trim())
      .forEach(e => {
        def[e.key] = e.value;
      });
    value.default = def;
  }
</script>

<div class="form-control w-full">
  <label class="label">
    <span class="label-text font-semibold">{label}</span>
    {#if showHelp}
      <span class="label-text-alt text-xs">
        Support dynamic expressions: <code class="text-xs">{'{{ expression }}'}</code>
      </span>
    {/if}
  </label>

  <div class="space-y-4">
    <!-- Add Headers -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" checked />
      <div class="collapse-title text-sm font-medium">
        Add Headers ({addEntries.length})
      </div>
      <div class="collapse-content space-y-2">
        {#each addEntries as entry, index}
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Header name"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.key}
              on:input={updateAddValue}
            />
            <input
              type="text"
              placeholder="Value (or {'{{ expression }}'} )"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.value}
              on:input={updateAddValue}
            />
            <button
              type="button"
              class="btn btn-sm btn-error btn-square"
              on:click={() => removeAddEntry(index)}
            >
              ✕
            </button>
          </div>
        {/each}
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          on:click={addHeader}
        >
          + Add Header
        </button>
      </div>
    </div>

    <!-- Remove Headers -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" />
      <div class="collapse-title text-sm font-medium">
        Remove Headers
      </div>
      <div class="collapse-content">
        <input
          type="text"
          placeholder="Comma-separated header names to remove"
          class="input input-bordered input-sm w-full"
          bind:value={removeValue}
          on:input={updateRemoveValue}
        />
        <p class="text-xs text-gray-500 mt-1">
          Example: x-debug-info, x-internal-token
        </p>
      </div>
    </div>

    <!-- Default Headers -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" />
      <div class="collapse-title text-sm font-medium">
        Default Headers ({defaultEntries.length})
      </div>
      <div class="collapse-content space-y-2">
        {#each defaultEntries as entry, index}
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Header name"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.key}
              on:input={updateDefaultValue}
            />
            <input
              type="text"
              placeholder="Default value"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.value}
              on:input={updateDefaultValue}
            />
            <button
              type="button"
              class="btn btn-sm btn-error btn-square"
              on:click={() => removeDefaultEntry(index)}
            >
              ✕
            </button>
          </div>
        {/each}
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          on:click={addDefaultHeader}
        >
          + Add Default Header
        </button>
      </div>
    </div>
  </div>
</div>
