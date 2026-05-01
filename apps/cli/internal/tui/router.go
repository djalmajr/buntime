package tui

type router[T comparable] struct {
	current T
	history []T
}

func newRouter[T comparable](initial T) *router[T] {
	return &router[T]{current: initial}
}

func (r *router[T]) CanGoBack() bool {
	return len(r.history) > 0
}

func (r *router[T]) Current() T {
	return r.current
}

func (r *router[T]) Pop() (T, bool) {
	if len(r.history) == 0 {
		return r.current, false
	}

	last := len(r.history) - 1
	r.current = r.history[last]
	r.history = r.history[:last]
	return r.current, true
}

func (r *router[T]) Push(screen T) {
	r.history = append(r.history, r.current)
	r.current = screen
}

func (r *router[T]) Replace(screen T) {
	r.current = screen
}

func (r *router[T]) Reset(screen T) {
	r.current = screen
	r.history = nil
}
