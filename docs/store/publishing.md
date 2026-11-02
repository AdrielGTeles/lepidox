# Publicação nas lojas

Roteiro para publicar o Lepidox na Chrome Web Store e no Microsoft Edge Add-ons como desenvolvedor individual. O mesmo pacote serve para as duas lojas.

Os requisitos das lojas mudam com frequência. Os números abaixo (taxa, tamanhos, limites) refletem o que valia quando este roteiro foi escrito; confira no painel de cada loja na hora de enviar.

## 1. Gerar o pacote

```sh
npm test
npm run build
```

O arquivo sai em `dist/lepidox-<versão>.zip`. Ele contém só o que a extensão usa em execução: `manifest.json`, `_locales`, `assets/icons`, `src`, `LICENSE` e `NOTICE`.

Antes de enviar, carregue a pasta do repositório em `chrome://extensions` e em `edge://extensions` (modo do desenvolvedor, **Carregar sem compactação**) e faça uma rotação completa em cada navegador.

A cada nova versão, altere `version` em `manifest.json` **e** em `package.json` (o `npm test` acusa se ficarem diferentes) e registre a mudança em `CHANGELOG.md`.

## 2. Imagens: qual arquivo vai em cada campo

Os caminhos abaixo partem da raiz do repositório. Todas as imagens já estão prontas, nos tamanhos e formatos pedidos; basta arrastar o arquivo indicado para o campo.

### Chrome Web Store (Ficha da loja → Recursos gráficos)

| Campo no painel | Tamanho | Arquivo |
| --- | --- | --- |
| **Ícone da Store** | 128×128 | `assets/icons/lepidox-128.png` |
| **Capturas de tela** | 1280×800 | `store/screenshots/en/01-rotation.png`, `02-lists.png` e `03-investigate.png`, nessa ordem |
| **Bloco promocional pequeno** | 440×280 | `store/promo-small-440x280.png` |
| **Bloco promocional de letreiro** | 1400×560 | Opcional. Não há arquivo; deixe vazio |
| **Vídeo promocional** | | Opcional. Deixe vazio |

Ao adicionar o idioma português (Brasil) à ficha, envie as capturas de `store/screenshots/pt_BR/`, na mesma ordem.

### Microsoft Edge Add-ons (Fichas da loja, uma por idioma)

| Campo no painel | Tamanho | Arquivo |
| --- | --- | --- |
| **Logotipo da loja** (*Extension Store logo*) | 300×300 | `store/logo-300.png` |
| **Bloco promocional pequeno** (*Small promotional tile*) | 440×280 | `store/promo-small-440x280.png` |
| **Capturas de tela** (*Screenshots*) | 1280×800 | `store/screenshots/en/` na ficha em inglês, `store/screenshots/pt_BR/` na ficha em português |
| **Bloco promocional grande** (*Large promotional tile*) | 1400×560 | Opcional. Não há arquivo; deixe vazio |

O logotipo e o bloco promocional são os mesmos nas duas fichas.

### Dentro do pacote (nada a enviar)

Estes arquivos vão no zip e o navegador os usa sozinho:

| Onde aparece | Arquivo |
| --- | --- |
| Página de extensões e janela de instalação | `assets/icons/lepidox-16.png`, `-32`, `-48` e `-128` |
| Barra do navegador, uma cor por estado | `assets/icons/lepidox-active-*.png`, `-paused-*`, `-error-*` e `-inactive-*` |
| Popup e página de opções | `assets/icons/lepidox.svg` |

O `README.md` também usa `assets/icons/lepidox.svg`.

### Formatos

- O ícone 128×128 e o logotipo 300×300 têm fundo transparente. O ícone reserva 16 px de margem em cada lado, como a Chrome Web Store pede; o logotipo do Edge ocupa a área inteira.
- As capturas e o bloco promocional são PNG de 24 bits, sem transparência, exigência da Chrome Web Store.

### Refazer as imagens

A logo é desenhada por `scripts/icons.mjs`. Depois de alterá-la:

```sh
npm run icons                       # ícones, lepidox.svg e store/logo-300.png
node scripts/store-screenshots.mjs  # capturas e bloco promocional
npm run build                       # pacote com os ícones novos
```

`scripts/store-screenshots.mjs` abre a extensão em um navegador sem janela e usa dados de demonstração, em português e inglês. Ele requer a ferramenta de desenvolvimento externa `playwright-core`; se ela estiver em outra pasta, defina `PLAYWRIGHT_MODULE` com o caminho de seu arquivo `index.mjs`. No Windows, usa o Edge instalado; `LEPIDOX_BROWSER_CHANNEL` permite escolher outro Chromium com suporte a extensões. `LEPIDOX_STORE_OUT` permite gravar uma prévia em outra pasta. Essas ferramentas não fazem parte do pacote da extensão.

Abra [docs/brand.html](../brand.html) para conferir a logo em fundo claro e escuro, nos tamanhos reais e em cada estado.

A pasta `dist/` não é versionada. Dela, só o zip vai para as lojas; prévias gravadas ali ficam desatualizadas quando a logo muda e precisam ser refeitas com os comandos acima.

Os textos da ficha (descrição, justificativas de permissão, instruções para o revisor) estão em [listing.md](listing.md), em inglês e português.

## 3. Política de privacidade

As duas lojas pedem um endereço público. Use:

`https://github.com/AdrielGTeles/lepidox/blob/main/PRIVACY.md`

O arquivo precisa estar no ramo `main` do repositório público antes do envio.

## 4. Chrome Web Store

1. Crie a conta de desenvolvedor em <https://chrome.google.com/webstore/devconsole>. Há uma taxa única de registro (US$ 5) e a conta Google precisa ter verificação em duas etapas.
2. Em **Conta**, preencha nome do editor e e-mail de contato (o e-mail fica visível na ficha) e verifique o e-mail.
3. Declare a condição de **comerciante ou não comerciante** (exigência da União Europeia). Quem publica um projeto pessoal, sem atividade comercial, declara-se não comerciante. Se a extensão passar a ser parte de um negócio, a declaração muda e exige dados de contato verificados.
4. **Novo item** → envie o zip.
5. **Ficha da loja**: descrição, categoria e idioma. Em **Recursos gráficos**, envie o ícone, as capturas e o bloco promocional indicados na [seção 2](#2-imagens-qual-arquivo-vai-em-cada-campo). Adicione o idioma português (Brasil) e cole os textos correspondentes.
6. **Práticas de privacidade**: finalidade única, justificativa de cada permissão, declaração de que não há código remoto, uso de dados e o endereço da política. Os textos prontos estão em [listing.md](listing.md).
7. **Distribuição**: público, todas as regiões, gratuito.
8. **Instruções de teste**: cole o roteiro de [listing.md](listing.md).
9. Envie para revisão. A permissão `tabs` costuma levar a uma análise mais demorada; a justificativa detalhada ajuda.

## 5. Microsoft Edge Add-ons

1. Cadastre-se como desenvolvedor individual no Partner Center: <https://partner.microsoft.com/dashboard/microsoftedge/public/login>. O cadastro para extensões do Edge não tem custo.
2. **Criar nova extensão** → envie o mesmo zip.
3. **Disponibilidade**: pública, todos os mercados.
4. **Propriedades**: categoria, endereço da política de privacidade, site e contato de suporte.
5. **Fichas da loja**: uma por idioma (inglês e português do Brasil). Descrição, termos de busca e as imagens indicadas na [seção 2](#2-imagens-qual-arquivo-vai-em-cada-campo): logotipo 300×300, bloco promocional pequeno e capturas.
6. **Notas para certificação**: cole o roteiro de teste de [listing.md](listing.md).
7. Publique. A certificação pode levar alguns dias úteis.

## 6. Depois de publicado

- Substitua, no `README.md`, o trecho "Store listings are in preparation" pelos endereços das fichas.
- Atualizações seguem o roteiro da [seção 7](#7-publicar-uma-atualização).
- Os atalhos sugeridos só valem para instalações novas. Quem já tem a extensão mantém os atalhos que estavam atribuídos.

## 7. Publicar uma atualização

O exemplo usa a 1.2.0; para as próximas versões, troque o número.

### Antes de enviar

1. Mescle o ramo da versão (`release/1.2.0`) no `main`. A política de privacidade que as lojas mostram é a do `main`, e a 1.2.0 a alterou (permissões novas); ela precisa estar publicada antes do envio.
2. Gere e confira o pacote:

   ```sh
   npm test
   npm run build   # dist/lepidox-1.2.0.zip
   ```

3. Descompacte o zip numa pasta, carregue essa pasta em `chrome://extensions` e em `edge://extensions` (**Carregar sem compactação**) e faça uma rotação completa em cada navegador.
4. Crie a tag `v1.2.0` no commit enviado e envie a tag ao GitHub. Opcionalmente, crie uma *release* no GitHub com o zip anexado.

### Chrome Web Store

1. Abra o painel (<https://chrome.google.com/webstore/devconsole>) e clique no Lepidox.
2. Aba **Pacote** → **Enviar novo pacote** → `dist/lepidox-1.2.0.zip`. A loja recusa um pacote cuja versão não seja maior que a publicada.
3. Aba **Ficha da loja**: cole a descrição nova de [listing.md](listing.md) em inglês e em português e troque as capturas de tela que mudaram. Na 1.2.0 mudou só a `02-lists.png` (`store/screenshots/en/` na ficha em inglês, `store/screenshots/pt_BR/` na ficha em português).
4. Aba **Práticas de privacidade**: acrescente as justificativas de `webNavigation` e `power` que estão em [listing.md](listing.md). As demais declarações não mudam.
5. **Enviar para revisão** e confirme. Na janela de confirmação há uma caixa para publicar automaticamente depois da aprovação. Se você a desmarcar, terá até 30 dias para publicar pelo painel; depois disso o envio volta a ser rascunho.
6. Enquanto a revisão corre, a versão publicada continua no ar. A revisão é a mesma de um item novo; o prazo varia.

### Microsoft Edge Add-ons

1. Abra o Partner Center (<https://partner.microsoft.com/dashboard/microsoftedge/overview>) e clique no Lepidox.
2. **Pacotes**: envie `dist/lepidox-1.2.0.zip` no lugar do anterior.
3. **Fichas da loja**: em cada idioma, a descrição nova de [listing.md](listing.md) e a captura `02-lists.png` nova.
4. **Notas para certificação** (em **Envio** / *Submission*): cole o roteiro atualizado de [listing.md](listing.md).
5. **Publicar**. A certificação de uma atualização pode levar até 7 dias úteis. O envio termina quando a coluna **Status** mostra **Na loja** (*In the store*).
6. Para corrigir algo durante a certificação, use **Cancelar envio** ou edite e publique de novo. Isso tira o envio da fila, e a análise recomeça do zero.

### Depois da publicação

- Os navegadores instalam a atualização sozinhos, em geral em algumas horas. Para conferir sem esperar: `chrome://extensions` ou `edge://extensions` → **Modo do desenvolvedor** → **Atualizar**.
- As permissões novas da 1.2.0 não mostram aviso novo: `webNavigation` tem o mesmo aviso de `tabs` ("Ler seu histórico de navegação") e `power` não tem aviso. Por isso a extensão não é desativada à espera de aprovação.
- **Só nesta atualização:** uma rotação que estava rodando na 1.1.0 para quando a 1.2.0 chega e precisa ser iniciada de novo uma vez. A 1.1.0 não registrava em que janela e em quais abas estava. Da 1.2.0 em diante, uma atualização não interrompe mais a rotação.
- Os atalhos não mudam numa atualização: cada instalação mantém os que já tinha.

## Compatibilidade verificada

A versão 1.2.0 foi exercitada a partir do pacote gerado no Microsoft Edge 156 e no Chromium 141 (o motor do Chrome):

- **Atualização:** com a rotação rodando, a extensão foi recarregada como numa atualização. A rotação continuou nas mesmas abas. Testado no Edge; o Chromium de teste não recarrega extensões carregadas por linha de comando.
- **Reinício:** três reinícios seguidos com restauração de sessão. A rotação voltou nas abas restauradas, sem abrir cópias.
- **Falhas e títulos:**
  - um endereço inexistente foi marcado como erro em cerca de 1,5 s, com `ERR_NAME_NOT_RESOLVED`;
  - um dashboard chamado "Server errors by region" ficou como carregado.
- **Zoom:** 150 % aplicado só à aba da tela.
- **Tela cheia em janela própria:** sai ao pausar, volta ao continuar e se mantém ao avançar de tela. A janela fecha ao encerrar.
- **Avisos:** não cobrem nenhum controle no popup nem na página de opções, inclusive em largura estreita.

A versão 1.1.0 foi exercitada de ponta a ponta a partir do pacote gerado, no Microsoft Edge 154 e no Chromium 153 (o motor do Chrome), com a interface em português: criar lista, colar endereços, reordenar, verificar acessos, iniciar, pausar, pular, editar durante a rotação, importar, exportar e encerrar. A interface em inglês foi exercitada no Chromium.

O Google Chrome de marca não aceita carregar extensões por linha de comando, então nele o teste é manual (passo 1). O manifesto exige a versão 120 ou superior.
