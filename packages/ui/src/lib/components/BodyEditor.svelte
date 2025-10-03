<script lang="ts">
  import type { ModificationRules } from '../api/routes';

  export let value: ModificationRules = {};
  export let label: string = 'Body';
  export let showHelp: boolean = true;

  // 确保基本结构
  $: value = {
    add: value?.add || {},
    remove: value?.remove || [],
    replace: value?.replace || {},
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

  function addField() {
    addEntries = [...addEntries, { key: '', value: '' }];
  }

  function removeAddEntry(index: number) {
    addEntries = addEntries.filter((_, i) => i !== index);
    updateAddValue();
  }

  function updateAddValue() {
    const add: Record<string, any> = {};
    addEntries
      .filter(e => e.key.trim())
      .forEach(e => {
        // 尝试解析 JSON 值
        try {
          add[e.key] = JSON.parse(e.value);
        } catch {
          add[e.key] = e.value;
        }
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

  // Replace section
  let replaceEntries: Array<{ key: string; value: string }> = [];
  $: {
    replaceEntries = Object.entries(value.replace || {}).map(([key, val]) => ({
      key,
      value: String(val)
    }));
  }

  function addReplaceField() {
    replaceEntries = [...replaceEntries, { key: '', value: '' }];
  }

  function removeReplaceEntry(index: number) {
    replaceEntries = replaceEntries.filter((_, i) => i !== index);
    updateReplaceValue();
  }

  function updateReplaceValue() {
    const replace: Record<string, any> = {};
    replaceEntries
      .filter(e => e.key.trim())
      .forEach(e => {
        try {
          replace[e.key] = JSON.parse(e.value);
        } catch {
          replace[e.key] = e.value;
        }
      });
    value.replace = replace;
  }

  // Default section
  let defaultEntries: Array<{ key: string; value: string }> = [];
  $: {
    defaultEntries = Object.entries(value.default || {}).map(([key, val]) => ({
      key,
      value: String(val)
    }));
  }

  function addDefaultField() {
    defaultEntries = [...defaultEntries, { key: '', value: '' }];
  }

  function removeDefaultEntry(index: number) {
    defaultEntries = defaultEntries.filter((_, i) => i !== index);
    updateDefaultValue();
  }

  function updateDefaultValue() {
    const def: Record<string, any> = {};
    defaultEntries
      .filter(e => e.key.trim())
      .forEach(e => {
        try {
          def[e.key] = JSON.parse(e.value);
        } catch {
          def[e.key] = e.value;
        }
      });
    value.default = def;
  }
</script>

<div class="form-control w-full">
  <label class="label">
    <span class="label-text font-semibold">{label}</span>
    {#if showHelp}
      <span class="label-text-alt text-xs">
        Support JSON values and dynamic expressions
      </span>
    {/if}
  </label>

  <div class="space-y-4">
    <!-- Add Fields -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" checked />
      <div class="collapse-title text-sm font-medium">
        Add Fields ({addEntries.length})
      </div>
      <div class="collapse-content space-y-2">
        {#each addEntries as entry, index}
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Field name"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.key}
              on:input={updateAddValue}
            />
            <input
              type="text"
              placeholder="Value or expression"
              class="input input-bordered input-sm flex-[2]"
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
          on:click={addField}
        >
          + Add Field
        </button>
      </div>
    </div>

    <!-- Remove Fields -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" />
      <div class="collapse-title text-sm font-medium">
        Remove Fields
      </div>
      <div class="collapse-content">
        <input
          type="text"
          placeholder="Comma-separated field names to remove"
          class="input input-bordered input-sm w-full"
          bind:value={removeValue}
          on:input={updateRemoveValue}
        />
        <p class="text-xs text-gray-500 mt-1">
          Example: debug_mode, internal_flag
        </p>
      </div>
    </div>

    <!-- Replace Fields -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" />
      <div class="collapse-title text-sm font-medium">
        Replace Fields ({replaceEntries.length})
      </div>
      <div class="collapse-content space-y-2">
        {#each replaceEntries as entry, index}
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Field name"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.key}
              on:input={updateReplaceValue}
            />
            <input
              type="text"
              placeholder="Replacement value"
              class="input input-bordered input-sm flex-[2]"
              bind:value={entry.value}
              on:input={updateReplaceValue}
            />
            <button
              type="button"
              class="btn btn-sm btn-error btn-square"
              on:click={() => removeReplaceEntry(index)}
            >
              ✕
            </button>
          </div>
        {/each}
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          on:click={addReplaceField}
        >
          + Add Replace Field
        </button>
      </div>
    </div>

    <!-- Default Fields -->
    <div class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" />
      <div class="collapse-title text-sm font-medium">
        Default Fields ({defaultEntries.length})
      </div>
      <div class="collapse-content space-y-2">
        {#each defaultEntries as entry, index}
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Field name"
              class="input input-bordered input-sm flex-1"
              bind:value={entry.key}
              on:input={updateDefaultValue}
            />
            <input
              type="text"
              placeholder="Default value"
              class="input input-bordered input-sm flex-[2]"
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
          on:click={addDefaultField}
        >
          + Add Default Field
        </button>
      </div>
    </div>
  </div>
</div>
