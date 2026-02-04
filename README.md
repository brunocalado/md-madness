# Install

```js
https://raw.githubusercontent.com/brunocalado/md-madness/refs/heads/main/module.json
```

# Macros

Cria um visualizador que tenta simular um jornal com noticias. 
Notícias: Você cria um journal e cada página dele vira uma notícia. Você coloca o UUID em uuid.
Ads: Você cria um journal e cada página é um ad. Você coloca o UUID em ads.
Obituário: Você cria um journal e cada página é um obituário. Você coloca o UUID em obituary.

```js
madness.News({title: 'asdfasd', uuid: 'JournalEntry.j4fCkn5OW0NKOytK', ads: 'JournalEntry.CqHb96Q3uhApT3PT', obituary: 'JournalEntry.nQ7sZavch78PymLK' });
```

Gera nomes aleatórios.
```js
madness.QuickNames();
```

Todos os seus atores no mundo serão colocados como teleporte no tipo de movimento do token.
```js
madness.SetPrototypeToken({movementAction: "blink"})
```

# Stuff

- Todos os novos actors criados são colocados com o movimento blink por padrão.
- Várias configurações são colocadas em um padrão.
