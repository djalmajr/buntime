import { html } from "htm/preact";
import { connect } from "unistore/preact";
import { getFiltered } from "../store/selectors.js";
import style from "./app.css" with { type: "css" };
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { Todo } from "./todo.js";

document.adoptedStyleSheets.push(style);

const mapStateToProps = (state) => ({
  filtered: getFiltered(state),
});

export const App = connect(mapStateToProps)(
  ({ filtered }) => html`
    <div class="app__container">
      <section class="app__content">
        <${Header} />
        <section class="app__todos">
          <ul>
            ${filtered.map((todo) => html`<${Todo} key=${todo.uid} todo=${todo} />`)}
          </ul>
        </section>
        <${Footer} />
      </section>
      <footer class="app__info">
        <p>Double-click to edit a todo</p>
        <p>Written by <a href="https://user.dev">Djalma Jr.</a></p>
      </footer>
    </div>
  `,
);
