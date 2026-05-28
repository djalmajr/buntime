import { html } from "htm/preact";
import { connect } from "unistore/preact";
import { ClearButton } from "../components/clear-button.js";
import { actions } from "../store/actions.js";
import { getAll, getCompleted, getIncompleted } from "../store/selectors.js";
import style from "./footer.css" with { type: "css" };

document.adoptedStyleSheets.push(style);

const cn = (hash, curr) => (hash === curr ? "selected" : "");

const mapStateToProps = (state) => ({
  all: getAll(state),
  completed: getCompleted(state),
  incompleted: getIncompleted(state),
  hash: state.hash,
});

export const Footer = connect(
  mapStateToProps,
  actions,
)((props) => {
  const { all, completed, incompleted, hash, clearCompletedTodos } = props;
  const remaining = incompleted.length;

  if (!all.length) return html``;

  return html`
    <footer class="footer__container">
      <span class="footer__count">
        <strong>${remaining}</strong> item${~-remaining ? "s" : ""} left
      </span>
      <ul class="footer__filters">
        <li><a class="${cn(hash, "all")}" href="#/all">All</a></li>
        <li><a class="${cn(hash, "active")}" href="#/active">Active</a></li>
        <li>
          <a class="${cn(hash, "completed")}" href="#/completed">Completed</a>
        </li>
      </ul>
      <${ClearButton}
        isEmpty=${!completed.length}
        onClick=${() => clearCompletedTodos()}
      />
    </footer>
  `;
});
