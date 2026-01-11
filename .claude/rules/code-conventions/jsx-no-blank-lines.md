# JSX No Blank Lines

**RULE: Do NOT add blank lines inside JSX tags**

Blank lines inside JSX make the code harder to read and create inconsistent formatting.

## Examples

```tsx
// WRONG - blank lines inside JSX
return (
  <Layout>
    <Header />

    <Content>
      {items.map((item) => (
        <Item key={item.id} />
      ))}

      <Footer />
    </Content>
  </Layout>
);

// CORRECT - no blank lines inside JSX
return (
  <Layout>
    <Header />
    <Content>
      {items.map((item) => (
        <Item key={item.id} />
      ))}
      <Footer />
    </Content>
  </Layout>
);
```

## When Blank Lines ARE Acceptable

- Between separate return statements or logical blocks outside JSX
- Before a return statement
- Between function declarations

```tsx
// OK - blank line before return
function Component() {
  const data = useData();

  return <div>{data}</div>;
}

// OK - blank line between functions
function ComponentA() {
  return <div />;
}

function ComponentB() {
  return <span />;
}
```
