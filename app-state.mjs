const STATES = new Set(['idle', 'requesting-permission', 'capturing', 'processing', 'candidate', 'playing', 'error']);

function codedError(code) { const error = new Error(code); error.code = code; return error; }

export function createAppStateMachine({ onChange = () => {} } = {}) {
  let state = 'idle';
  onChange(state);
  return Object.freeze({
    getState: () => state,
    transition(nextState) {
      if (!STATES.has(nextState)) throw codedError('invalid_app_state');
      state = nextState;
      onChange(state);
      return state;
    },
  });
}
