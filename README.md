# Editor XML

Ferramenta client-side (React + Vite) para importar um XML de NF-e, revisar os
itens, identificar peças que formam um conjunto (kit) e montar/confirmar esses
conjuntos antes de exportar o resultado.

Portado da funcionalidade de importação de XML do
[Frente-de-Loja](https://github.com/FrankLoubak/Frente-de-Loja) (aba
"Importar XML" em `src/App.tsx`), removendo as partes que dependiam do backend
(checagem de produtos/emitente já cadastrados, persistência em banco).

## Funcionalidades

- Importar um XML de NF-e (drag & drop ou seleção de arquivo).
- Ver os itens da nota, com custo e venda sugerida (markup configurável).
- Sugestão automática de conjuntos com base na semelhança dos nomes dos itens,
  com opção de confirmar as sugestões selecionadas ou ignorá-las.
- Montagem manual de um novo conjunto, escolhendo dois itens e um nome.
- Desfazer um conjunto já montado (automático ou manual), devolvendo os itens
  originais para a lista.
- Confirmar os conjuntos montados e exportar o resultado final em XML. As
  peças que foram absorvidas por um conjunto não entram no XML exportado —
  só o conjunto composto (ou o item original, se nunca foi unido).

## Rodando localmente

```bash
npm install
npm run dev
```
