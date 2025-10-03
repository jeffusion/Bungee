<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let open = false;
  export let title = '确认操作';
  export let message = '确定要执行此操作吗？';
  export let confirmText = '确认';
  export let cancelText = '取消';
  export let confirmClass = 'btn-error';

  const dispatch = createEventDispatcher();

  function handleConfirm() {
    dispatch('confirm');
    open = false;
  }

  function handleCancel() {
    dispatch('cancel');
    open = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <dialog class="modal modal-open" on:click={handleBackdropClick}>
    <div class="modal-box">
      <h3 class="font-bold text-lg">{title}</h3>
      <p class="py-4">{message}</p>
      <div class="modal-action">
        <button class="btn" on:click={handleCancel}>{cancelText}</button>
        <button class="btn {confirmClass}" on:click={handleConfirm}>{confirmText}</button>
      </div>
    </div>
  </dialog>
{/if}